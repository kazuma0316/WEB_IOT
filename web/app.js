/*
 * この画面を見る人の端末ID。
 * すれちがいは2台ぶんの記録が届くが、ここで指定した端末の値だけを表示し、
 * 相手側の観測値は出さない。
 * raspberry_pi/proximity.js の MY_DEVICE_ID と同じ値にすること。
 */
const MY_DEVICE_ID = "device-a";

// 端末ログらしく "2026-09-17 21:45:31" の固定幅で表示する
const timeFormatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
});

function textOrDash(value) {
    return value === null || value === undefined || value === "" ? "-" : String(value);
}

function formatTimestamp(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "????-??-?? ??:??:??";

    const parts = {};
    for (const part of timeFormatter.formatToParts(date)) parts[part.type] = part.value;

    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function formatRssi(value) {
    const rssi = Number(value);
    // 平均RSSIは割り算の結果なので小数第1位で丸める
    return Number.isFinite(rssi) ? `${Math.round(rssi * 10) / 10} dBm` : "-";
}

// 緯度・経度は割り算の結果で桁が余るので、小数第6位(約10cm)で切る
function formatCoordinate(value) {
    return Number.isFinite(value) ? value.toFixed(6) : "-";
}

// 誤差の情報が来たときだけ「±5m」を添える
function formatAccuracy(gps) {
    return gps?.accuracy == null ? "" : ` ±${gps.accuracy}m`;
}

/*
 * 音声プレイヤーはURLごとに1つだけ作って使い回す。
 * 2秒ごとの再描画で作り直すと、そのたびに再生が止まってしまうため。
 */
const audioPlayers = new Map();

function getAudioPlayer(url) {
    const existing = audioPlayers.get(url);
    if (existing) return existing;

    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = url;
    audio.preload = "none";

    // 再生できないときは何も起きず原因が分からないので、理由を残す。
    audio.addEventListener("error", () => {
        console.error(`音声の読み込みに失敗: ${url}`, audio.error);
    });

    audioPlayers.set(url, audio);
    return audio;
}

function createField(className, text) {
    const field = document.createElement("span");
    field.className = `field ${className}`;
    field.textContent = text;
    return field;
}

function createLine(className, fields) {
    const line = document.createElement("div");
    line.className = className;
    line.append(...fields);
    return line;
}

function createObservationLines(observation, fallbackDeviceId) {
    const deviceId = observation?.deviceId ?? fallbackDeviceId;
    const name = createField("device-name", textOrDash(deviceId));

    if (!observation) {
        return [createLine("log-sub", [name, createField("note", "No Data")])];
    }

    const lines = [
        createLine("log-sub", [
            name,
            createField("detected", `相手：${textOrDash(observation.detectedDevice)}`),
            createField("rssi", `電波強度：${formatRssi(observation.rssi)}`),
            createField("hr", `心拍：${observation.heartRate?.bpm == null ? "-" : `${observation.heartRate.bpm} bpm`}`),
            createField("gps gps-latitude", `緯度：${formatCoordinate(observation.gps?.latitude)}`),
            createField(
                "gps gps-longitude",
                `経度：${formatCoordinate(observation.gps?.longitude)}${formatAccuracy(observation.gps)}`
            ),
            createField("timestamp-raw", `すれちがった日：${formatTimestamp(observation.timestamp)}`)
        ])
    ];

    const recording = observation.recording;
    const duration = recording?.durationSec == null ? "" : ` (${recording.durationSec}s)`;

    if (recording?.url) {
        const line = createLine("log-sub-deep", [
            createField("rec", `録音：${textOrDash(recording.fileName)}${duration}`)
        ]);
        line.appendChild(getAudioPlayer(recording.url));
        lines.push(line);
    } else {
        lines.push(createLine("log-sub-deep", [createField("rec", "録音：-")]));
    }

    return lines;
}

function renderEvent(event) {
    const block = document.createElement("div");
    block.className = "log-event";

    block.appendChild(createLine("log-line", [
        createField("timestamp", formatTimestamp(event.createdAt)),
        createField("event-id", String(event.id).padStart(4, "0")),
        createField(
            event.confirmed ? "status status-confirmed" : "status status-pending",
            event.confirmed ? "OK" : "--"
        ),
        createField("devices", `${event.deviceA} ↔ ${event.deviceB}`),
        createField("rssi", `平均電波強度：${formatRssi(event.averageRssi)}`),
        createField("note", event.confirmed ? "双方向確認済み" : "片方向のみ")
    ]));

    // 自分の端末の記録だけを出す。届いていなければ "No Data" になる
    block.append(...createObservationLines(event.observations?.[MY_DEVICE_ID], MY_DEVICE_ID));

    return block;
}

function showMessage(eventList, className, text) {
    const line = document.createElement("div");
    line.className = className;
    line.textContent = text;
    eventList.replaceChildren(line);
}

// 前回の応答。同じ内容なら描画をやり直さない。
let lastEventsJson = "";

async function loadEvents() {
    const eventList = document.getElementById("event-list");
    try {
        const response = await fetch("/events");
        if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

        /*
         * 中身が前回と同じなら何もしない。
         * 毎回作り直すと、再生中の音声が止まったり
         * 文字の選択が解除されたりしてしまう。
         */
        const json = await response.text();
        if (json === lastEventsJson) return;
        lastEventsJson = json;

        const events = JSON.parse(json);
        if (!Array.isArray(events)) throw new Error("/events の応答が配列ではありません");

        const newestEvents = [...events].sort(
            (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
        );
        if (newestEvents.length === 0) {
            showMessage(eventList, "empty-message", "接近イベントはまだありません。");
            return;
        }
        eventList.replaceChildren(...newestEvents.map(renderEvent));
    } catch (error) {
        console.error("イベント取得失敗:", error);
        showMessage(eventList, "error-message", `イベント取得失敗: ${error.message}`);

        // 画面をエラー表示に置き換えたので、次は内容が同じでも描き直す。
        lastEventsJson = "";
    }
}

loadEvents();
setInterval(loadEvents, 2000);
