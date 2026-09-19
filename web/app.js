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

function formatGps(gps) {
    if (gps?.latitude == null || gps?.longitude == null) return "-";

    const accuracy = gps.accuracy == null ? "" : ` ±${gps.accuracy}m`;
    return `${gps.latitude},${gps.longitude}${accuracy}`;
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
        return [createLine("log-sub", [name, createField("note", "no data")])];
    }

    const lines = [
        createLine("log-sub", [
            name,
            createField("detected", `detected=${textOrDash(observation.detectedDevice)}`),
            createField("rssi", `rssi=${formatRssi(observation.rssi)}`),
            createField("hr", `hr=${observation.heartRate?.bpm == null ? "-" : `${observation.heartRate.bpm} bpm`}`),
            createField("gps", `gps=${formatGps(observation.gps)}`),
            createField("timestamp-raw", `t=${formatTimestamp(observation.timestamp)}`)
        ])
    ];

    const recording = observation.recording;
    const duration = recording?.durationSec == null ? "" : ` (${recording.durationSec}s)`;

    if (recording?.url) {
        const audio = document.createElement("audio");
        audio.controls = true;
        audio.src = recording.url;
        audio.preload = "none";

        const line = createLine("log-sub-deep", [
            createField("rec", `rec=${textOrDash(recording.fileName)}${duration}`)
        ]);
        line.appendChild(audio);
        lines.push(line);
    } else {
        lines.push(createLine("log-sub-deep", [createField("rec", "rec=-")]));
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
        createField("rssi", `avg=${formatRssi(event.averageRssi)}`),
        createField("note", event.confirmed ? "双方向確認済み" : "片方向のみ")
    ]));

    block.append(...createObservationLines(event.observations?.[event.deviceA], event.deviceA));
    block.append(...createObservationLines(event.observations?.[event.deviceB], event.deviceB));

    return block;
}

function showMessage(eventList, className, text) {
    const line = document.createElement("div");
    line.className = className;
    line.textContent = text;
    eventList.replaceChildren(line);
}

async function loadEvents() {
    const eventList = document.getElementById("event-list");
    try {
        const response = await fetch("/events");
        if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
        const events = await response.json();
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
    }
}

loadEvents();
setInterval(loadEvents, 2000);
