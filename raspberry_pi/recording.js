import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function safeDeviceId(deviceId) {
    return deviceId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function createFileName(deviceId) {
    const time = new Date().toISOString().replace(/[-:.]/g, "");
    return `${safeDeviceId(deviceId)}_${time}_${randomUUID().slice(0, 8)}.wav`;
}

export function recordWav({ deviceId, alsaDevice, durationSec }) {
    const fileName = createFileName(deviceId);
    const filePath = path.join(os.tmpdir(), fileName);
    const args = [
        "-D", alsaDevice,
        "-f", "S16_LE",
        "-r", "16000",
        "-c", "1",
        "-d", String(durationSec),
        "-t", "wav",
        filePath
    ];

    return new Promise((resolve, reject) => {
        const recorder = spawn("arecord", args, { stdio: ["ignore", "ignore", "pipe"] });
        let errorOutput = "";
        recorder.stderr.on("data", data => { errorOutput += data.toString(); });
        recorder.on("error", reject);
        recorder.on("close", code => {
            if (code === 0) resolve({ fileName, filePath, durationSec });
            else reject(new Error(errorOutput.trim() || `arecord exited with code ${code}`));
        });
    });
}

export async function uploadRecording(recording, uploadUrl) {
    const wavData = await readFile(recording.filePath);
    const response = await fetch(uploadUrl, {
        method: "POST",
        headers: {
            "Content-Type": "audio/wav",
            "X-File-Name": recording.fileName
        },
        body: wavData
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    await unlink(recording.filePath);
    return {
        fileName: result.fileName,
        url: result.url,
        durationSec: recording.durationSec
    };
}
