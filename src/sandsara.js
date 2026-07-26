"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeSandsaraTrack = decodeSandsaraTrack;
const RECORD_SIZE = 6;
const COMMA = 0x2c;
const NEWLINE = 0x0a;
const NOMINAL_RADIUS = 32768;
function decodeSandsaraTrack(bytes) {
    if (bytes.byteLength === 0) {
        throw new Error("The Sandsara track is empty.");
    }
    if (bytes.byteLength % RECORD_SIZE !== 0) {
        throw new Error(`Invalid file size: ${bytes.byteLength} bytes. ` +
            "A Sandsara track must contain complete six-byte records.");
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const points = [];
    const warnings = [];
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maximumRadius = 0;
    let outsideCircleCount = 0;
    for (let offset = 0; offset < bytes.byteLength; offset += RECORD_SIZE) {
        const recordNumber = offset / RECORD_SIZE;
        if (bytes[offset + 2] !== COMMA) {
            throw new Error(`Invalid record ${recordNumber}: expected comma 0x2C ` +
                `at byte ${offset + 2}, found 0x${bytes[offset + 2]
                    .toString(16)
                    .padStart(2, "0")}.`);
        }
        if (bytes[offset + 5] !== NEWLINE) {
            throw new Error(`Invalid record ${recordNumber}: expected newline 0x0A ` +
                `at byte ${offset + 5}, found 0x${bytes[offset + 5]
                    .toString(16)
                    .padStart(2, "0")}.`);
        }
        // true means little-endian.
        const x = view.getInt16(offset, true);
        const y = view.getInt16(offset + 3, true);
        const radius = Math.hypot(x, y);
        if (radius > NOMINAL_RADIUS) {
            outsideCircleCount++;
        }
        maximumRadius = Math.max(maximumRadius, radius);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        points.push({ x, y });
    }
    if (outsideCircleCount > 0) {
        warnings.push(`${outsideCircleCount} points lie outside the nominal ` +
            `${NOMINAL_RADIUS}-unit drawing radius.`);
    }
    return {
        points,
        byteLength: bytes.byteLength,
        minX,
        maxX,
        minY,
        maxY,
        maximumRadius,
        warnings
    };
}
//# sourceMappingURL=sandsara.js.map