// MAX30102 は現在 I2C で検出できていないため、架空の値は生成しない。
// 実機読み取りを追加するときは、この関数内だけを置き換える。
export async function getHeartRate() {
    console.warn("Heart rate unavailable: MAX30102 reader is not implemented");
    return { bpm: null };
}
