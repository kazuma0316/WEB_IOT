import test from "node:test";
import assert from "node:assert/strict";
import { parseNmeaCoordinate, parseNmeaSentence } from "./gps.js";

test("NMEA coordinate conversion handles hemispheres", () => {
    assert.equal(parseNmeaCoordinate("3459.7000", "N"), 34 + 59.7 / 60);
    assert.equal(parseNmeaCoordinate("13356.1000", "E"), 133 + 56.1 / 60);
    assert.equal(parseNmeaCoordinate("3459.7000", "S"), -(34 + 59.7 / 60));
    assert.equal(parseNmeaCoordinate("13356.1000", "W"), -(133 + 56.1 / 60));
});

test("GGA returns coordinates and altitude", () => {
    const result = parseNmeaSentence(
        "$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,"
    );
    assert.equal(result.hasFix, true);
    assert.ok(Math.abs(result.latitude - 48.1173) < 1e-9);
    assert.ok(Math.abs(result.longitude - 11.516666666666667) < 1e-9);
    assert.equal(result.altitude, 545.4);
    assert.equal(result.accuracy, null);
});

test("RMC invalid status reports no fix", () => {
    const result = parseNmeaSentence(
        "$GPRMC,123519,V,4807.038,N,01131.000,E,0.0,0.0,230394,,"
    );
    assert.deepEqual(result, { hasFix: false });
});
