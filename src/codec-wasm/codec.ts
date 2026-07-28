export type I32 = number;

const RECORD_SIZE: I32 = 6;
const COMMA: I32 = 44;
const NEWLINE: I32 = 10;

let input: Array<I32> = new Array<I32>();
let output: Array<I32> = new Array<I32>();
let pointX: Array<I32> = new Array<I32>();
let pointY: Array<I32> = new Array<I32>();
let pointSet: Array<I32> = new Array<I32>();
let pointCountValue: I32 = 0;
let badRecordValue: I32 = -1;
let badByteValue: I32 = -1;

export function cVer(): I32 {
  return 1;
}

export function cLoad(byteCount: I32): I32 {
  if (byteCount < 0) return -1;
  input = zero(byteCount);
  output = new Array<I32>();
  pointX = new Array<I32>();
  pointY = new Array<I32>();
  pointSet = new Array<I32>();
  pointCountValue = 0;
  badRecordValue = -1;
  badByteValue = -1;
  return 0;
}

export function cSetByte(index: I32, value: I32): I32 {
  if (index < 0 || index >= input.length || value < 0 || value > 255) return -1;
  input[index] = value;
  return 0;
}

export function cDecode(): I32 {
  badRecordValue = -1;
  badByteValue = -1;
  if (input.length === 0) return -1;
  if (input.length % RECORD_SIZE !== 0) return -2;

  pointCountValue = input.length / RECORD_SIZE;
  pointX = zero(pointCountValue);
  pointY = zero(pointCountValue);
  pointSet = filled(pointCountValue, 1);

  let pointIndex: I32 = 0;
  while (pointIndex < pointCountValue) {
    const offset: I32 = pointIndex * RECORD_SIZE;
    if (input[offset + 2] !== COMMA) {
      badRecordValue = pointIndex;
      badByteValue = offset + 2;
      return -3;
    }
    if (input[offset + 5] !== NEWLINE) {
      badRecordValue = pointIndex;
      badByteValue = offset + 5;
      return -4;
    }
    pointX[pointIndex] = signed16(input[offset] + input[offset + 1] * 256);
    pointY[pointIndex] = signed16(input[offset + 3] + input[offset + 4] * 256);
    pointIndex += 1;
  }
  return 0;
}

export function cCnt(): I32 {
  return pointCountValue;
}

export function cX(index: I32): I32 {
  if (index < 0 || index >= pointCountValue) return 0;
  return pointX[index];
}

export function cY(index: I32): I32 {
  if (index < 0 || index >= pointCountValue) return 0;
  return pointY[index];
}

export function cBadRec(): I32 {
  return badRecordValue;
}

export function cBadByte(): I32 {
  return badByteValue;
}

export function cCfg(pointCount: I32): I32 {
  if (pointCount < 2) return -1;
  pointCountValue = pointCount;
  pointX = zero(pointCount);
  pointY = zero(pointCount);
  pointSet = zero(pointCount);
  output = new Array<I32>();
  return 0;
}

export function cSetPt(index: I32, x: I32, y: I32): I32 {
  if (index < 0 || index >= pointCountValue) return -1;
  if (x < -32768 || x > 32767 || y < -32768 || y > 32767) return -2;
  pointX[index] = x;
  pointY[index] = y;
  pointSet[index] = 1;
  return 0;
}

export function cEncode(): I32 {
  if (pointCountValue < 2) return -1;
  output = zero(pointCountValue * RECORD_SIZE);
  let pointIndex: I32 = 0;
  while (pointIndex < pointCountValue) {
    if (pointSet[pointIndex] === 0) return -2;
    const offset: I32 = pointIndex * RECORD_SIZE;
    const x: I32 = unsigned16(pointX[pointIndex]);
    const y: I32 = unsigned16(pointY[pointIndex]);
    output[offset] = x % 256;
    output[offset + 1] = Math.floor(x / 256);
    output[offset + 2] = COMMA;
    output[offset + 3] = y % 256;
    output[offset + 4] = Math.floor(y / 256);
    output[offset + 5] = NEWLINE;
    pointIndex += 1;
  }
  return 0;
}

export function cByteCnt(): I32 {
  return output.length;
}

export function cByte(index: I32): I32 {
  if (index < 0 || index >= output.length) return 0;
  return output[index];
}

function signed16(value: I32): I32 {
  return value >= 32768 ? value - 65536 : value;
}

function unsigned16(value: I32): I32 {
  return value < 0 ? value + 65536 : value;
}

function zero(length: I32): Array<I32> {
  return filled(length, 0);
}

function filled(length: I32, value: I32): Array<I32> {
  const values: Array<I32> = new Array<I32>();
  let index: I32 = 0;
  while (index < length) {
    values.push(value);
    index += 1;
  }
  return values;
}
