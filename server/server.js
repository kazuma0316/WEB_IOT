import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = 3000;

// A→B と B→A を同じイベントとみなす時間
const MERGE_WINDOW_MS = 10 * 1000;

// 統合済みイベントを保存
const events = [];

let nextEventId = 1;

app.use(express.json());

// 既存の web フォルダをブラウザ向けに配信
app.use(express.static(path.join(__dirname, "../web")));


// サーバー動作確認
app.get("/", (req, res) => {
    res.send("Proximity Logger Server is running!");
});


// 接近イベント受信
app.post("/event", (req, res) => {
    const body = req.body;

    const deviceId = body.deviceId;

    // 現在の proximity.js の形式に対応
    // peerId を使っている版でも動くようにしておく
    const detectedDevice =
        body.detectedDevice ?? body.peerId;

    const rssi = body.rssi;
    const timestamp =
        body.timestamp ?? new Date().toISOString();

    // 必須データ確認
    if (!deviceId || !detectedDevice) {
        return res.status(400).json({
            status: "error",
            message: "deviceId and detectedDevice are required"
        });
    }

    const now = Date.now();
    const receivedAt = new Date(now).toISOString();

    /*
     * device_A → device_B
     * device_B → device_A
     *
     * のどちらでも同じpairKeyになるようにソートする
     */
    const [deviceA, deviceB] =
        [deviceId, detectedDevice].sort();

    const pairKey = `${deviceA}::${deviceB}`;

    /*
     * 同じ端末ペアについて、
     * MERGE_WINDOW_MS以内に作られたイベントを探す
     */
    let targetEvent = null;

    for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i];

        if (
            event.pairKey === pairKey &&
            now - event.lastReceivedAtMs <= MERGE_WINDOW_MS
        ) {
            targetEvent = event;
            break;
        }
    }

    /*
     * まだイベントが存在しない場合
     */
    if (!targetEvent) {
        targetEvent = {
            id: nextEventId++,

            pairKey,

            deviceA,
            deviceB,

            createdAt: receivedAt,
            updatedAt: receivedAt,

            lastReceivedAtMs: now,

            confirmed: false,

            observations: {}
        };

        events.push(targetEvent);
    }

    /*
     * この端末からの観測情報を保存
     *
     * observations.device_A
     * observations.device_B
     *
     * のようになる
     */
    targetEvent.observations[deviceId] = {
        deviceId,
        detectedDevice,
        rssi,
        timestamp,
        receivedAt
    };

    targetEvent.updatedAt = receivedAt;
    targetEvent.lastReceivedAtMs = now;

    /*
     * AとBの両方から通知を受け取ったら
     * 双方向確認済み
     */
    const observationA =
        targetEvent.observations[deviceA];

    const observationB =
        targetEvent.observations[deviceB];

    targetEvent.confirmed =
        Boolean(observationA && observationB);

    /*
     * RSSIの平均も計算
     */
    const rssiValues = Object.values(
        targetEvent.observations
    )
        .map(observation => Number(observation.rssi))
        .filter(value => Number.isFinite(value));

    if (rssiValues.length > 0) {
        targetEvent.averageRssi =
            rssiValues.reduce(
                (sum, value) => sum + value,
                0
            ) / rssiValues.length;
    }

    console.log("Received proximity event:");
    console.log(JSON.stringify(body, null, 2));

    console.log("Merged event:");
    console.log(JSON.stringify(targetEvent, null, 2));

    res.json({
        status: "ok",
        event: targetEvent
    });
});


// 統合済みイベント一覧取得
app.get("/events", (req, res) => {
    /*
     * lastReceivedAtMs は内部処理用なので
     * クライアントには返さない
     */
    const result = events.map(event => {
        const {
            lastReceivedAtMs,
            ...publicEvent
        } = event;

        return publicEvent;
    });

    res.json(result);
});


app.listen(PORT, "0.0.0.0", () => {
    console.log(
        `Server running on http://0.0.0.0:${PORT}`
    );
});
