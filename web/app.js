async function loadEvents() {
    try {
        const response = await fetch("/events");

        if (!response.ok) {
            throw new Error(
                `HTTP ${response.status} ${response.statusText}`
            );
        }

        const events = await response.json();

        if (!Array.isArray(events)) {
            throw new Error("/events の応答が配列ではありません");
        }

        const eventList =
            document.getElementById(
                "event-list"
            );

        eventList.replaceChildren();

        // APIの格納順に依存せず、新しいイベントを上に表示する
        const newestEvents = [...events].sort(
            (a, b) =>
                new Date(b.createdAt).getTime() -
                new Date(a.createdAt).getTime()
        );

        if (newestEvents.length === 0) {
            const row = document.createElement("tr");
            const cell = document.createElement("td");
            cell.colSpan = 5;
            cell.className = "empty-message";
            cell.textContent = "接近イベントはまだありません。";
            row.appendChild(cell);
            eventList.appendChild(row);
            return;
        }

        for (const event of newestEvents) {
            const row =
                document.createElement("tr");

            const createdAt = new Date(event.createdAt);
            const time = Number.isNaN(createdAt.getTime())
                ? "不明"
                : createdAt.toLocaleString("ja-JP", {
                    timeZone: "Asia/Tokyo"
                });

            const values = [
                event.id,
                `${event.deviceA} ↔ ${event.deviceB}`,
                event.confirmed
                    ? "双方向確認済み"
                    : "片方向のみ",
                Number.isFinite(Number(event.averageRssi))
                    ? `${event.averageRssi} dBm`
                    : "未取得",
                time
            ];

            values.forEach((value, index) => {
                const cell = document.createElement("td");
                cell.textContent = value;

                if (index === 2) {
                    const statusClass = event.confirmed
                        ? "status-confirmed"
                        : "status-pending";
                    cell.classList.add("status", statusClass);
                }

                row.appendChild(cell);
            });

            eventList.appendChild(row);
        }
    } catch (error) {
        console.error(
            "イベント取得失敗:",
            error
        );
    }
}

// 起動時
loadEvents();

// 2秒ごとに更新
setInterval(
    loadEvents,
    2000
);
