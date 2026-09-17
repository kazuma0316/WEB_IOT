import { createReadStream } from "node:fs";
import { spawnSync } from "node:child_process";
import readline from "node:readline";

const EMPTY_GPS = Object.freeze({
    latitude: null,
    longitude: null,
    altitude: null,
    accuracy: null
});

let latestGps = null;
let latestGpsTime = 0;
let latestAltitudeTime = 0;

function hasValidChecksum(sentence) {
    const asterisk = sentence.indexOf("*");
    if (asterisk === -1) return true;

    let checksum = 0;
    for (const character of sentence.slice(1, asterisk)) {
        checksum ^= character.charCodeAt(0);
    }

    return checksum === Number.parseInt(sentence.slice(asterisk + 1, asterisk + 3), 16);
}

// NMEA の ddmm.mmmm / dddmm.mmmm を10進緯度経度へ変換する。
export function parseNmeaCoordinate(value, direction) {
    if (!value || !direction) return null;

    const raw = Number(value);
    if (!Number.isFinite(raw)) return null;

    const degrees = Math.floor(raw / 100);
    const minutes = raw - degrees * 100;
    if (minutes < 0 || minutes >= 60) return null;

    let decimal = degrees + minutes / 60;
    if (direction === "S" || direction === "W") decimal *= -1;
    if (!["N", "S", "E", "W"].includes(direction)) return null;
    return decimal;
}

export function parseNmeaSentence(sentence) {
    const line = sentence.trim();
    if (!line.startsWith("$") || !hasValidChecksum(line)) return null;

    const fields = line.split("*")[0].split(",");
    const type = fields[0].slice(-3);

    if (type === "GGA") {
        const fixQuality = Number(fields[6]);
        if (!Number.isFinite(fixQuality) || fixQuality <= 0) return { hasFix: false };

        const latitude = parseNmeaCoordinate(fields[2], fields[3]);
        const longitude = parseNmeaCoordinate(fields[4], fields[5]);
        const altitude = fields[9] === "" ? null : Number(fields[9]);
        if (latitude === null || longitude === null) return null;

        return {
            hasFix: true,
            latitude,
            longitude,
            altitude: Number.isFinite(altitude) ? altitude : null,
            accuracy: null
        };
    }

    if (type === "RMC") {
        if (fields[2] !== "A") return { hasFix: false };

        const latitude = parseNmeaCoordinate(fields[3], fields[4]);
        const longitude = parseNmeaCoordinate(fields[5], fields[6]);
        if (latitude === null || longitude === null) return null;

        return { hasFix: true, latitude, longitude };
    }

    return null;
}

function receiveSentence(sentence) {
    const parsed = parseNmeaSentence(sentence);
    if (!parsed) return;

    if (!parsed.hasFix) {
        latestGps = null;
        latestGpsTime = 0;
        latestAltitudeTime = 0;
        return;
    }

    latestGps = {
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        altitude: parsed.altitude ?? latestGps?.altitude ?? null,
        accuracy: null
    };
    latestGpsTime = Date.now();
    if (parsed.altitude !== undefined && parsed.altitude !== null) {
        latestAltitudeTime = latestGpsTime;
    }
}

export function startGpsReader(devicePath = "/dev/serial0", baudRate = 9600) {
    // Node.js標準機能だけではUART速度を設定できないため、Linuxのsttyを使う。
    const configured = spawnSync(
        "stty",
        ["-F", devicePath, String(baudRate), "raw", "-echo"],
        { encoding: "utf8" }
    );
    if (configured.error || configured.status !== 0) {
        const message = configured.error?.message || configured.stderr.trim();
        console.error(`GPS data unavailable: UART setup failed: ${message}`);
    }

    const stream = createReadStream(devicePath, { encoding: "ascii" });
    const lines = readline.createInterface({ input: stream });

    lines.on("line", receiveSentence);
    stream.on("error", error => {
        console.error(`GPS data unavailable: ${error.message}`);
    });

    console.log(`GPS reader started: ${devicePath} (${baudRate} baud)`);
    return stream;
}

export function getLatestGps(maxAgeMs) {
    if (!latestGps || Date.now() - latestGpsTime > maxAgeMs) {
        return { ...EMPTY_GPS };
    }
    return {
        ...latestGps,
        altitude: Date.now() - latestAltitudeTime <= maxAgeMs
            ? latestGps.altitude
            : null
    };
}
