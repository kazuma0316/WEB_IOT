import { spawn } from "node:child_process";
import readline from "node:readline";
import { getLatestGps, startGpsReader } from "./gps.js";
import { getHeartRate } from "./heart-rate.js";
import {
    recordWav,
    stopActiveRecordings,
    uploadRecording
} from "./recording.js";

// ==============================
// 設定
// ==============================

// このRaspberry PiのID
// advertise時のnameと同じ名前にする
const MY_DEVICE_ID = "device-a";

// 全端末共通のUUID
const UUID = "8f3a2c10-7b21-4e58-9a65-21c489d87f01";

// 接近判定のRSSIしきい値
const RSSI_THRESHOLD = -60;

// 何回連続でしきい値以上なら接近とするか
const REQUIRED_COUNT = 3;

// 接近イベント発生後のクールダウン時間
const COOLDOWN_MS = 30 * 1000;


// ==============================
// サーバー設定
// ==============================

// Windows PCのIPv4アドレス
const SERVER_BASE_URL = "http://192.168.1.145:3000";
const SERVER_URL = `${SERVER_BASE_URL}/event`;
const RECORDING_UPLOAD_URL = `${SERVER_BASE_URL}/recording`;

// センサー・録音設定
const GPS_DEVICE_PATH = "/dev/serial0";
const GPS_BAUD_RATE = 9600;
const GPS_MAX_AGE_MS = 30 * 1000;
const ALSA_DEVICE = "plughw:0,0";
const RECORDING_DURATION_SEC = 3;


// ==============================
// 状態
// ==============================

/*
各Bluetooth端末の情報を保存する。

例:

devices = Map {
    "AA:BB:CC:DD:EE:01" => {
        name: "device-b",
        consecutiveCount: 2,
        lastEventTime: 0
    },

    "AA:BB:CC:DD:EE:02" => {
        name: "device-c",
        consecutiveCount: 1,
        lastEventTime: 0
    }
}
*/

const devices = new Map();
let shuttingDown = false;

// GPSは起動時から読み続け、イベント時には最新の有効値をコピーする。
const gpsStream = startGpsReader(GPS_DEVICE_PATH, GPS_BAUD_RATE);


// ==============================
// bluetoothctl 起動
// ==============================

const bluetoothctl = spawn("bluetoothctl", [], {
    stdio: ["pipe", "pipe", "pipe"]
});


// stdoutを1行ずつ読む
const rl = readline.createInterface({
    input: bluetoothctl.stdout
});


// ==============================
// ANSIカラーコード除去
// ==============================

function cleanLine(line) {

    return line
        .replace(/\x1b\[[0-9;]*m/g, "")
        .trim();
}


// ==============================
// Bluetooth端末取得
// ==============================

function getDevice(address) {

    if (!devices.has(address)) {

        devices.set(
            address,
            {
                name: null,
                consecutiveCount: 0,
                lastEventTime: 0
            }
        );
    }

    return devices.get(address);
}


// ==============================
// Bluetooth端末名更新
// ==============================

function updateDeviceName(address, name) {

    if (!name) {
        return;
    }

    name = name.trim();

    if (!name) {
        return;
    }

    /*
    bluetoothctlによってはname部分に

    AA:BB:CC:DD:EE:FF

    や

    AA-BB-CC-DD-EE-FF

    のようなMACアドレス相当の文字列が
    表示されることがある。

    その場合は端末名として扱わない。
    */

    const normalizedName = name
        .replace(/-/g, ":")
        .toLowerCase();

    const normalizedAddress = address.toLowerCase();

    if (normalizedName === normalizedAddress) {
        return;
    }


    const device = getDevice(address);

    const oldName = device.name;

    device.name = name;


    // 名前が新しく判明した場合だけ表示
    if (oldName !== name) {

        console.log(
            `Device identified: ${address} -> ${name}`
        );
    }
}


// ==============================
// サーバーへイベント送信
// ==============================

async function sendEventToServer(event) {

    console.log("");
    console.log("Sending event to server...");
    console.log(`URL: ${SERVER_URL}`);

    try {

        const response = await fetch(
            SERVER_URL,
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify(event)
            }
        );


        // HTTPエラー
        if (!response.ok) {

            throw new Error(
                `HTTP ${response.status} ${response.statusText}`
            );
        }


        // サーバーからの応答
        const responseText = await response.text();

        console.log("Event sent successfully.");

        if (responseText) {

            console.log(
                "Server response:",
                responseText
            );
        }

    } catch (error) {

        console.error(
            "Failed to send event:",
            error.message
        );
    }
}


// ==============================
// 接近確定後のセンサーデータ取得
// ==============================

async function handleProximityEvent(address, device, rssi) {
    const eventData = {
        deviceId: MY_DEVICE_ID,
        detectedDevice: device.name,
        rssi,
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

    // 1つのセンサーが失敗しても、他の取得処理とイベント送信は続ける。
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
        const localRecording = await recordWav({
            deviceId: MY_DEVICE_ID,
            alsaDevice: ALSA_DEVICE,
            durationSec: RECORDING_DURATION_SEC
        });

        if (shuttingDown) {
            return;
        }

        eventData.recording = await uploadRecording(localRecording, RECORDING_UPLOAD_URL);
    } catch (error) {
        console.error(`Recording failed: ${error.message}`);
    }

    if (shuttingDown) {
        return;
    }

    console.log("");
    console.log("========================");
    console.log("PROXIMITY EVENT");
    console.log(`me:     ${eventData.deviceId}`);
    console.log(`target: ${eventData.detectedDevice}`);
    console.log(`address:${address}`);
    console.log(`rssi:   ${eventData.rssi}`);
    console.log(`time:   ${eventData.timestamp}`);
    console.log("========================");
    console.log("EVENT JSON:", JSON.stringify(eventData));

    if (!shuttingDown) {
        await sendEventToServer(eventData);
    }
}


// ==============================
// Bluetooth出力処理
// ==============================

rl.on("line", (rawLine) => {

    const line = cleanLine(rawLine);

    if (!line) {
        return;
    }

    console.log("RAW:", line);


    // ----------------------------------
    // 新しいBluetooth端末を発見
    //
    // 例:
    //
    // [NEW] Device AA:BB:CC:DD:EE:FF device-b
    // ----------------------------------

    let match = line.match(
        /\[NEW\] Device ([0-9A-Fa-f:]{17})(?: (.+))?/
    );

    if (match) {

        const address = match[1];
        const name = match[2];

        // 端末情報を作成
        getDevice(address);

        // 名前が取得できた場合
        if (name) {

            updateDeviceName(
                address,
                name
            );
        }
    }


    // ----------------------------------
    // Name / Aliasが後から通知された場合
    //
    // 例:
    //
    // [CHG] Device AA:BB:CC:DD:EE:FF Name: device-b
    //
    // [CHG] Device AA:BB:CC:DD:EE:FF Alias: device-b
    // ----------------------------------

    match = line.match(
        /\[CHG\] Device ([0-9A-Fa-f:]{17}) (?:Name|Alias): (.+)/
    );

    if (match) {

        const address = match[1];
        const name = match[2];

        updateDeviceName(
            address,
            name
        );
    }


    // ----------------------------------
    // RSSI取得
    //
    // 以下の両方の形式に対応
    //
    // RSSI: -55
    //
    // RSSI: 0xffffffdf (-33)
    // ----------------------------------

    const rssiMatch = line.match(
        /\[CHG\] Device ([0-9A-Fa-f:]{17}) RSSI:\s+(?:0x[0-9A-Fa-f]+\s+\((-?\d+)\)|(-?\d+))/
    );

    if (!rssiMatch) {
        return;
    }


    const address = rssiMatch[1];


    // 0xffffffdf (-33)
    //
    // rssiMatch[2] = -33
    //
    // RSSI: -55
    //
    // rssiMatch[3] = -55

    const rssi = Number(
        rssiMatch[2] ?? rssiMatch[3]
    );


    // ----------------------------------
    // 端末情報を取得
    // ----------------------------------

    const device = getDevice(address);


    // ----------------------------------
    // まだ端末名が分からない
    // ----------------------------------

    if (!device.name) {

        console.log(
            `Unknown device ${address}: waiting for name`
        );

        return;
    }


    // ----------------------------------
    // 自分自身は無視
    // ----------------------------------

    if (device.name === MY_DEVICE_ID) {
        return;
    }


    // ----------------------------------
    // RSSIが正常な数値か確認
    // ----------------------------------

    if (Number.isNaN(rssi)) {

        console.log(
            `${device.name} RSSI: invalid`
        );

        return;
    }


    // ----------------------------------
    // RSSI = 0は無効値
    // ----------------------------------

    if (rssi === 0) {

        console.log(
            `${device.name} RSSI: unavailable`
        );

        return;
    }


    // ----------------------------------
    // 明らかな異常値を除外
    // ----------------------------------

    if (rssi < -127 || rssi > -1) {

        console.log(
            `${device.name} RSSI: invalid (${rssi})`
        );

        return;
    }


    console.log(
        `${device.name} RSSI: ${rssi} dBm`
    );


    // ----------------------------------
    // 接近判定
    // ----------------------------------

    checkProximity(
        address,
        device,
        rssi
    );
});


// ==============================
// 接近判定
// ==============================

function checkProximity(
    address,
    device,
    rssi
) {

    // ----------------------------------
    // RSSIがしきい値以上
    // ----------------------------------

    if (rssi >= RSSI_THRESHOLD) {

        device.consecutiveCount++;

        console.log(
            `${device.name} close count: ` +
            `${device.consecutiveCount}/${REQUIRED_COUNT}`
        );

    } else {

        // この端末だけ連続回数をリセット
        device.consecutiveCount = 0;

        console.log(
            `${device.name}: Not close`
        );

        return;
    }


    // ----------------------------------
    // 必要回数に達していない
    // ----------------------------------

    if (device.consecutiveCount < REQUIRED_COUNT) {
        return;
    }


    // 必要回数に到達
    device.consecutiveCount = 0;


    // ==============================
    // クールダウン
    // ==============================

    const now = Date.now();


    if (
        now - device.lastEventTime
        < COOLDOWN_MS
    ) {

        console.log(
            `${device.name}: Cooldown...`
        );

        return;
    }


    // この端末だけクールダウン開始
    device.lastEventTime = now;


    // 録音中もBluetooth標準出力の読み取りを止めない。
    void handleProximityEvent(address, device, rssi);
}


// ==============================
// bluetoothctl エラー処理
// ==============================

bluetoothctl.stderr.on(
    "data",
    (data) => {

        console.error(
            "bluetoothctl error:",
            data.toString()
        );
    }
);


bluetoothctl.on(
    "close",
    (code) => {

        console.log(
            `bluetoothctl exited: ${code}`
        );
    }
);


// ==============================
// bluetoothctlにコマンドを送信
// ==============================

function send(command, allowDuringShutdown = false) {

    if (shuttingDown && !allowDuringShutdown) {
        return;
    }

    if (!bluetoothctl.stdin.writable) {
        return;
    }

    console.log(
        `COMMAND: ${command}`
    );

    bluetoothctl.stdin.write(
        command + "\n"
    );
}


// ==============================
// Bluetooth scan設定
// ==============================

console.log(
    `${MY_DEVICE_ID}: proximity detection starting...`
);


// Bluetooth ON
setTimeout(
    () => send("power on"),
    500
);


// scan設定
setTimeout(
    () => send("menu scan"),
    1000
);


// 古いフィルタを削除
setTimeout(
    () => send("clear"),
    1500
);


// BLEのみ
setTimeout(
    () => send("transport le"),
    2000
);


// RSSI -100以上
setTimeout(
    () => send("rssi -100"),
    2500
);


// 重複データを許可
setTimeout(
    () => send("duplicate-data on"),
    3000
);


// 共通UUID
//
// このUUIDをadvertiseしている端末だけを
// scan対象にする
setTimeout(
    () => send(`uuids ${UUID}`),
    3500
);


// scanメニューから戻る
setTimeout(
    () => send("back"),
    4000
);


// BLE scan開始
setTimeout(
    () => send("scan le"),
    4500
);


// ==============================
// Ctrl+C 終了処理
// ==============================

process.on(
    "SIGINT",
    () => {

        if (shuttingDown) {
            console.log("Force stopping...");
            process.exit(130);
        }

        shuttingDown = true;

        console.log(
            "\nStopping Bluetooth scan, GPS, and recording..."
        );

        // 終了開始後は新しいセンサー処理やイベント送信を行わない。
        gpsStream.destroy();
        stopActiveRecordings();
        rl.close();

        send("scan off", true);


        setTimeout(
            () => {

                if (!bluetoothctl.killed) {
                    bluetoothctl.kill("SIGTERM");
                }

                // 子プロセスが応答しない場合でも終了できるようにする。
                setTimeout(() => process.exit(0), 500);

            },
            500
        );
    }
);

// 終了中にbluetoothctl側のパイプが先に閉じても異常終了させない。
bluetoothctl.stdin.on("error", error => {
    if (!shuttingDown) {
        console.error("bluetoothctl input error:", error.message);
    }
});
