import readline from "node:readline";
import { getLatestGps, startGpsReader } from "./gps.js";
import { getHeartRate } from "./heart-rate.js";
import {
    recordWav,
    stopActiveRecordings,
    uploadRecording
} from "./recording.js";

// ==============================
// テスト設定
// ==============================

const MY_DEVICE_ID = "device-a";
const TEST_DETECTED_DEVICE = "device-b";
const TEST_RSSI = -50;

// Windows PCのIPv4アドレス
const SERVER_BASE_URL = "http://192.168.1.145:3000";
const SERVER_URL = `${SERVER_BASE_URL}/event`;
const RECORDING_UPLOAD_URL = `${SERVER_BASE_URL}/recording`;

const GPS_DEVICE_PATH = "/dev/serial0";
const GPS_BAUD_RATE = 9600;
const GPS_MAX_AGE_MS = 30 * 1000;

const ALSA_DEVICE = "plughw:0,0";
const RECORDING_DURATION_SEC = 3;


// ==============================
// 状態
// ==============================

let manualEventRequested = false;
let processingEvent = false;
let shuttingDown = false;

// proximity.jsと同様に、起動時から最新のGPS情報を保持する。
const gpsStream = startGpsReader(GPS_DEVICE_PATH, GPS_BAUD_RATE);


// ==============================
// イベント送信
// ==============================

async function sendEventToServer(eventData) {
    console.log(`Sending event to: ${SERVER_URL}`);

    try {
        const response = await fetch(SERVER_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(eventData)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        console.log("Event sent successfully.");
        console.log("Server response:", await response.text());
    } catch (error) {
        console.error(`Failed to send event: ${error.message}`);
    }
}


// ==============================
// センサーテストイベント作成
// ==============================

async function createTestEvent() {
    const eventData = {
        deviceId: MY_DEVICE_ID,
        detectedDevice: TEST_DETECTED_DEVICE,
        rssi: TEST_RSSI,
        timestamp: new Date().toISOString(),
        heartRate: { bpm: null },
        gps: {
            latitude: null,
            longitude: null,
            altitude: null,
            accuracy: null
        },
        recording: {
            fileName: null,
            url: null,
            durationSec: null
        }
    };

    // 各処理は独立させ、1つ失敗してもイベント送信を続ける。
    try {
        eventData.gps = getLatestGps(GPS_MAX_AGE_MS);
        if (eventData.gps.latitude === null) {
            console.warn("GPS data unavailable: no recent valid fix");
        }
    } catch (error) {
        console.error(`GPS data unavailable: ${error.message}`);
    }

    try {
        eventData.heartRate = await getHeartRate();
    } catch (error) {
        console.error(`Heart rate unavailable: ${error.message}`);
    }

    try {
        console.log(`Recording ${RECORDING_DURATION_SEC} seconds...`);
        const localRecording = await recordWav({
            deviceId: MY_DEVICE_ID,
            alsaDevice: ALSA_DEVICE,
            durationSec: RECORDING_DURATION_SEC
        });

        if (shuttingDown) return;

        eventData.recording = await uploadRecording(
            localRecording,
            RECORDING_UPLOAD_URL
        );
        console.log(`Recording uploaded: ${eventData.recording.url}`);
    } catch (error) {
        console.error(`Recording failed: ${error.message}`);
    }

    if (shuttingDown) return;

    console.log("EVENT JSON:");
    console.log(JSON.stringify(eventData, null, 2));
    await sendEventToServer(eventData);
}


// ==============================
// 手動フラグ処理
// ==============================

async function processManualEventFlag() {
    if (!manualEventRequested || processingEvent || shuttingDown) return;

    // フラグを消費してから非同期のセンサー処理を開始する。
    manualEventRequested = false;
    processingEvent = true;

    console.log("\nManual proximity event started.");

    try {
        await createTestEvent();
    } finally {
        processingEvent = false;
        if (!shuttingDown) showPrompt();
    }
}

function requestManualEvent() {
    if (processingEvent) {
        console.log("An event is already being processed. Please wait.");
        return;
    }

    manualEventRequested = true;
    void processManualEventFlag();
}


// ==============================
// コマンド入力
// ==============================

const commandInput = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function showPrompt() {
    commandInput.prompt();
}

commandInput.setPrompt("Press Enter or type 'event' to create an event > ");

commandInput.on("line", line => {
    const command = line.trim().toLowerCase();

    if (command === "" || command === "event") {
        requestManualEvent();
        return;
    }

    if (command === "quit" || command === "exit") {
        void shutdown();
        return;
    }

    console.log("Available commands: event, quit");
    showPrompt();
});


// ==============================
// 終了処理
// ==============================

async function shutdown() {
    if (shuttingDown) {
        process.exit(130);
    }

    shuttingDown = true;
    console.log("\nStopping GPS and recording...");

    commandInput.close();
    gpsStream.destroy();
    stopActiveRecordings();

    // arecordが終了通知を返さない場合でも停止できるようにする。
    setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT", () => {
    void shutdown();
});

console.log("Bluetooth-free proximity sensor test started.");
console.log(`deviceId=${MY_DEVICE_ID}, detectedDevice=${TEST_DETECTED_DEVICE}`);
showPrompt();
