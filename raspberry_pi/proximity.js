import { spawn } from "node:child_process";
import readline from "node:readline";

// ==============================
// 設定
// ==============================

// このRaspberry PiのID
const MY_DEVICE_ID = "device-a";

// 接近を検出したい相手のID
const TARGET_DEVICE_ID = "device-b";

// A・B共通のUUID
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

// ★ここをWindows PCのIPv4アドレスに変更する
const SERVER_URL = "http://192.168.1.25:3000/event";


// ==============================
// 状態
// ==============================

// TARGET_DEVICE_IDに対応するBluetoothアドレス
// MACアドレスは事前設定せずscan結果から自動取得する
let targetAddress = null;

// RSSIがしきい値以上だった連続回数
let consecutiveCount = 0;

// 最後にイベントが発生した時刻
let lastEventTime = 0;


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
    // [NEW] Device AA:BB:CC:DD:EE:FF device-b
    // ----------------------------------

    let match = line.match(
        /\[NEW\] Device ([0-9A-Fa-f:]{17}) (.+)/
    );

    if (match) {

        const address = match[1];
        const name = match[2].trim();

        if (name === TARGET_DEVICE_ID) {

            targetAddress = address;

            console.log(
                `Found ${TARGET_DEVICE_ID}`
            );
        }
    }


    // ----------------------------------
    // Name / Aliasが後から通知された場合
    //
    // 例:
    // [CHG] Device AA:BB:CC:DD:EE:FF Name: device-b
    // ----------------------------------

    match = line.match(
        /\[CHG\] Device ([0-9A-Fa-f:]{17}) (?:Name|Alias): (.+)/
    );

    if (match) {

        const address = match[1];
        const name = match[2].trim();

        if (name === TARGET_DEVICE_ID) {

            targetAddress = address;

            console.log(
                `Found ${TARGET_DEVICE_ID}`
            );
        }
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
    //      ↓
    // rssiMatch[2] = -33
    //
    // RSSI: -55
    //      ↓
    // rssiMatch[3] = -55

    const rssi = Number(
        rssiMatch[2] ?? rssiMatch[3]
    );


    // ----------------------------------
    // 相手端末がまだ特定されていない
    // ----------------------------------

    if (targetAddress === null) {
        return;
    }


    // ----------------------------------
    // 相手端末以外は無視
    // ----------------------------------

    if (address !== targetAddress) {
        return;
    }


    // ----------------------------------
    // RSSIが正常な数値か確認
    // ----------------------------------

    if (Number.isNaN(rssi)) {

        console.log(
            `${TARGET_DEVICE_ID} RSSI: invalid`
        );

        return;
    }


    // ----------------------------------
    // RSSI = 0は無効値
    // ----------------------------------

    if (rssi === 0) {

        console.log(
            `${TARGET_DEVICE_ID} RSSI: unavailable`
        );

        return;
    }


    // ----------------------------------
    // 明らかな異常値を除外
    // ----------------------------------

    if (rssi < -127 || rssi > -1) {

        console.log(
            `${TARGET_DEVICE_ID} RSSI: invalid (${rssi})`
        );

        return;
    }


    console.log(
        `${TARGET_DEVICE_ID} RSSI: ${rssi} dBm`
    );


    checkProximity(rssi);
});


// ==============================
// 接近判定
// ==============================

function checkProximity(rssi) {

    // ----------------------------------
    // RSSIがしきい値以上
    // ----------------------------------

    if (rssi >= RSSI_THRESHOLD) {

        consecutiveCount++;

        console.log(
            `close count: ${consecutiveCount}/${REQUIRED_COUNT}`
        );

    } else {

        // 遠くなったのでリセット
        consecutiveCount = 0;

        console.log("Not close");

        return;
    }


    // ----------------------------------
    // 必要回数に達していない
    // ----------------------------------

    if (consecutiveCount < REQUIRED_COUNT) {
        return;
    }


    // 必要回数に到達
    consecutiveCount = 0;


    // ==============================
    // クールダウン
    // ==============================

    const now = Date.now();


    if (now - lastEventTime < COOLDOWN_MS) {

        console.log("Cooldown...");

        return;
    }


    lastEventTime = now;


    // ==============================
    // 接近イベント生成
    // ==============================

    const event = {

        deviceId: MY_DEVICE_ID,

        detectedDevice: TARGET_DEVICE_ID,

        rssi: rssi,

        timestamp: new Date().toISOString()
    };


    // ==============================
    // コンソール表示
    // ==============================

    console.log("");
    console.log("========================");
    console.log("PROXIMITY EVENT");
    console.log(`me:     ${event.deviceId}`);
    console.log(`target: ${event.detectedDevice}`);
    console.log(`rssi:   ${event.rssi}`);
    console.log(`time:   ${event.timestamp}`);
    console.log("========================");

    console.log(
        "EVENT JSON:",
        JSON.stringify(event)
    );


    // ==============================
    // サーバーへ送信
    // ==============================

    sendEventToServer(event);
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

function send(command) {

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

        console.log(
            "\nStopping Bluetooth scan..."
        );

        send("scan off");


        setTimeout(
            () => {

                bluetoothctl.kill();

                process.exit(0);

            },
            500
        );
    }
);