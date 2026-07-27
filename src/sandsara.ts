export interface SandsaraPoint {
  readonly x: number;
  readonly y: number;
}

export interface DecodedSandsaraTrack {
  readonly points: readonly SandsaraPoint[];
  readonly byteLength: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly maximumRadius: number;
  readonly warnings: readonly string[];
}

export const SANDSARA_RADIUS = 32_767;

const RECORD_SIZE = 6;
const COMMA = 0x2c;
const NEWLINE = 0x0a;

export function decodeTrack(bytes: Uint8Array): DecodedSandsaraTrack {
  if (bytes.byteLength === 0) {
    throw new Error("The Sandsara track is empty.");
  }

  if (bytes.byteLength % RECORD_SIZE !== 0) {
    throw new Error(
      `Invalid file size: ${bytes.byteLength} bytes. ` +
      "A Sandsara track must contain complete six-byte records."
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const points: SandsaraPoint[] = [];
  const warnings: string[] = [];

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maximumRadius = 0;
  let outsideCircleCount = 0;

  for (let offset = 0; offset < bytes.byteLength; offset += RECORD_SIZE) {
    const recordNumber = offset / RECORD_SIZE;
    const comma = bytes[offset + 2];
    const newline = bytes[offset + 5];

    if (comma !== COMMA) {
      throw new Error(
        `Invalid record ${recordNumber}: expected comma 0x2C ` +
        `at byte ${offset + 2}, found ${formatByte(comma)}.`
      );
    }

    if (newline !== NEWLINE) {
      throw new Error(
        `Invalid record ${recordNumber}: expected newline 0x0A ` +
        `at byte ${offset + 5}, found ${formatByte(newline)}.`
      );
    }

    const x = view.getInt16(offset, true);
    const y = view.getInt16(offset + 3, true);
    const radius = Math.hypot(x, y);

    if (radius > SANDSARA_RADIUS + 1) {
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
    warnings.push(
      `${outsideCircleCount} points lie outside the nominal ` +
      `${SANDSARA_RADIUS}-unit drawing radius.`
    );
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

export function encodeTrack(points: readonly SandsaraPoint[]): Uint8Array {
  if (points.length < 2) {
    throw new Error("A Sandsara track must contain at least two points.");
  }

  const bytes = new Uint8Array(points.length * RECORD_SIZE);
  const view = new DataView(bytes.buffer);

  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (point === undefined) {
      throw new Error(`Missing point at index ${index}.`);
    }

    const x = validateCoordinate(point.x, "X", index);
    const y = validateCoordinate(point.y, "Y", index);
    const offset = index * RECORD_SIZE;

    view.setInt16(offset, x, true);
    bytes[offset + 2] = COMMA;
    view.setInt16(offset + 3, y, true);
    bytes[offset + 5] = NEWLINE;
  }

  return bytes;
}

export function ptsFromFlat(values: readonly number[]): SandsaraPoint[] {
  if (values.length % 2 !== 0) {
    throw new Error("The generated coordinate array contains an unmatched value.");
  }

  const points: SandsaraPoint[] = [];

  for (let index = 0; index < values.length; index += 2) {
    const x = values[index];
    const y = values[index + 1];

    if (x === undefined || y === undefined) {
      throw new Error(`Missing coordinate pair at array index ${index}.`);
    }

    points.push({
      x: validateCoordinate(x, "X", index / 2),
      y: validateCoordinate(y, "Y", index / 2)
    });
  }

  return points;
}

function validateCoordinate(value: number, axis: "X" | "Y", index: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${axis} coordinate ${index} is not a finite number.`);
  }

  const rounded = Math.round(value);

  if (rounded < -32_768 || rounded > 32_767) {
    throw new Error(
      `${axis} coordinate ${index} is outside the signed 16-bit range: ${rounded}.`
    );
  }

  return rounded;
}

function formatByte(value: number | undefined): string {
  if (value === undefined) {
    return "end of file";
  }

  return `0x${value.toString(16).toUpperCase().padStart(2, "0")}`;
}
