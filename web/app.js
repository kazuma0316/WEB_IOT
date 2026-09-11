function textOrDash(value) {
    return value === null || value === undefined || value === "" ? "-" : String(value);
}

function formatTimestamp(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? "-"
        : date.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

function createField(label, value) {
    const row = document.createElement("p");
    const heading = document.createElement("strong");
    heading.textContent = `${label}: `;
    row.append(heading, document.createTextNode(textOrDash(value)));
    return row;
}

function createObservationCard(observation, fallbackDeviceId) {
    const card = document.createElement("section");
    card.className = "observation-card";
    const title = document.createElement("h3");
    title.textContent = observation?.deviceId ?? fallbackDeviceId;
    card.appendChild(title);

    if (!observation) {
        card.appendChild(createField("Data", "No data"));
        return card;
    }

    card.appendChild(createField("Device ID", observation.deviceId));
    card.appendChild(createField("Detected Device", observation.detectedDevice));
    card.appendChild(createField("RSSI", observation.rssi == null ? null : `${observation.rssi} dBm`));
    card.appendChild(createField("Timestamp", formatTimestamp(observation.timestamp)));
    card.appendChild(createField(
        "Heart Rate",
        observation.heartRate?.bpm == null ? null : `${observation.heartRate.bpm} bpm`
    ));

    const latitude = observation.gps?.latitude;
    const longitude = observation.gps?.longitude;
    card.appendChild(createField(
        "GPS",
        latitude == null || longitude == null ? null : `${latitude}, ${longitude}`
    ));

    const recordingUrl = observation.recording?.url;
    if (recordingUrl) {
        const wrapper = document.createElement("div");
        wrapper.className = "recording";
        const label = document.createElement("strong");
        label.textContent = "Recording: ";
        const audio = document.createElement("audio");
        audio.controls = true;
        audio.src = recordingUrl;
        audio.preload = "none";
        wrapper.append(label, audio);
        card.appendChild(wrapper);
    } else {
        card.appendChild(createField("Recording", null));
    }

    return card;
}

function renderEvent(event) {
    const article = document.createElement("article");
    article.className = "event-card";
    const heading = document.createElement("h2");
    heading.textContent = `Event ${event.id}: ${event.deviceA} ↔ ${event.deviceB}`;
    const status = document.createElement("p");
    status.className = event.confirmed ? "status status-confirmed" : "status status-pending";
    status.textContent = event.confirmed ? "双方向確認済み" : "片方向のみ";

    const observations = document.createElement("div");
    observations.className = "observations";
    observations.append(
        createObservationCard(event.observations?.[event.deviceA], event.deviceA),
        createObservationCard(event.observations?.[event.deviceB], event.deviceB)
    );
    article.append(heading, status, observations);
    return article;
}

async function loadEvents() {
    const eventList = document.getElementById("event-list");
    try {
        const response = await fetch("/events");
        if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
        const events = await response.json();
        if (!Array.isArray(events)) throw new Error("/events の応答が配列ではありません");

        eventList.replaceChildren();
        const newestEvents = [...events].sort(
            (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
        );
        if (newestEvents.length === 0) {
            const message = document.createElement("p");
            message.className = "empty-message";
            message.textContent = "接近イベントはまだありません。";
            eventList.appendChild(message);
            return;
        }
        newestEvents.forEach(event => eventList.appendChild(renderEvent(event)));
    } catch (error) {
        console.error("イベント取得失敗:", error);
        eventList.textContent = "イベントを取得できませんでした。";
    }
}

loadEvents();
setInterval(loadEvents, 2000);
