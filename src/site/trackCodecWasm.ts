import type { DecodedSandsaraTrack, SandsaraPoint } from "../sandsara";
import { SANDSARA_RADIUS } from "../sandsara";

interface CodecWasmExports {
  readonly cVer: () => number;
  readonly cLoad: (byteCount: number) => number;
  readonly cSetByte: (index: number, value: number) => number;
  readonly cDecode: () => number;
  readonly cCnt: () => number;
  readonly cX: (index: number) => number;
  readonly cY: (index: number) => number;
  readonly cBadRec: () => number;
  readonly cBadByte: () => number;
  readonly cCfg: (pointCount: number) => number;
  readonly cSetPt: (index: number, x: number, y: number) => number;
  readonly cEncode: () => number;
  readonly cByteCnt: () => number;
  readonly cByte: (index: number) => number;
}

let codecPromise: Promise<CodecWasmExports> | null = null;

export async function decodeTrackWasm(bytes: Uint8Array): Promise<DecodedSandsaraTrack> {
  const codec = await loadCodec();
  status(codec.cLoad(bytes.byteLength), "prepare the decoder");
  for (let index = 0; index < bytes.length; index++) {
    status(codec.cSetByte(index, bytes[index] ?? 0), "copy the input track");
  }

  const decoded = codec.cDecode();
  if (decoded < 0) throw decodeError(codec, decoded, bytes.byteLength);

  const points: SandsaraPoint[] = [];
  const warnings: string[] = [];
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maximumRadius = 0;
  let outside = 0;

  for (let index = 0; index < codec.cCnt(); index++) {
    const x = codec.cX(index);
    const y = codec.cY(index);
    const radius = Math.hypot(x, y);
    if (radius > SANDSARA_RADIUS + 1) outside++;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    maximumRadius = Math.max(maximumRadius, radius);
    points.push({ x, y });
  }

  if (outside > 0) {
    warnings.push(`${outside} points lie outside the nominal ${SANDSARA_RADIUS}-unit drawing radius.`);
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

export async function encodeTrackWasm(points: readonly SandsaraPoint[]): Promise<Uint8Array> {
  const codec = await loadCodec();
  status(codec.cCfg(points.length), "prepare the encoder");
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (point === undefined) throw new Error(`Missing point at index ${index}.`);
    status(codec.cSetPt(index, point.x, point.y), `set point ${index}`);
  }
  status(codec.cEncode(), "encode the edited track");

  const bytes = new Uint8Array(codec.cByteCnt());
  for (let index = 0; index < bytes.length; index++) bytes[index] = codec.cByte(index);
  return bytes;
}

async function loadCodec(): Promise<CodecWasmExports> {
  if (codecPromise === null) codecPromise = instantiateCodec();
  return codecPromise;
}

async function instantiateCodec(): Promise<CodecWasmExports> {
  const url = new URL("../webview/track-codec.wasm", import.meta.url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load the WebAssembly track codec (${response.status}).`);
  const bytes = await response.arrayBuffer();
  const result = await WebAssembly.instantiate(bytes, {
    env: {
      abort: (_message: number, _filename: number, line: number, column: number): never => {
        throw new Error(`The WebAssembly track codec aborted at ${line}:${column}.`);
      }
    }
  });
  const codec = result.instance.exports as unknown as CodecWasmExports;
  if (codec.cVer() !== 1) throw new Error("The WebAssembly track codec version is not supported.");
  return codec;
}

function decodeError(codec: CodecWasmExports, code: number, byteLength: number): Error {
  if (code === -1) return new Error("The Sandsara track is empty.");
  if (code === -2) {
    return new Error(`Invalid file size: ${byteLength} bytes. A Sandsara track must contain complete six-byte records.`);
  }
  const record = codec.cBadRec();
  const position = codec.cBadByte();
  if (code === -3) return new Error(`Invalid record ${record}: expected comma 0x2C at byte ${position}.`);
  if (code === -4) return new Error(`Invalid record ${record}: expected newline 0x0A at byte ${position}.`);
  return new Error(`The WebAssembly track decoder failed (${code}).`);
}

function status(code: number, operation: string): void {
  if (code < 0) throw new Error(`The WebAssembly track codec could not ${operation} (${code}).`);
}
