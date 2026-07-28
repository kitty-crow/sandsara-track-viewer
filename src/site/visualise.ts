import "./trackMarked";
import type { DecodedSandsaraTrack, SandsaraPoint } from "../sandsara";
import type {
  FlatTrackPayload,
  TrackPreviewHostMessage,
  TrackPreviewWebviewMessage
} from "../webview/types";
import {
  downloadBytes,
  errorMessage,
  installBrowserHost,
  isMsg,
  requiredElement,
  safeDownloadName,
  sendHostMessage,
  setStatus
} from "./browserHost";
import { decodeTrackWasm, encodeTrackWasm } from "./trackCodecWasm";

const input = requiredElement<HTMLInputElement>("binInput");
let toolReady = false;
let pendingTrack: TrackPreviewHostMessage | null = null;
let currentFilename = "Sandsara-trackNumber-edited.bin";

installBrowserHost(async (message: unknown) => {
  if (isMsg(message, "ready")) {
    toolReady = true;
    if (pendingTrack === null) setStatus("Choose a Sandsara .bin file to inspect and edit.");
    else deliverPendingTrack();
    return;
  }

  if (isTrackMessage(message, "editTrack")) {
    try {
      const points = pointsFromFlat(message.points);
      pendingTrack = {
        type: "track",
        payload: payloadFromPoints(currentFilename, points, [])
      };
      deliverPendingTrack();
      setStatus(`Applied ${points.length.toLocaleString("en-GB")} edited points in memory.`);
    } catch (error: unknown) {
      setStatus(`Could not apply the edited track: ${errorMessage(error)}`, true);
    }
    return;
  }

  if (isTrackMessage(message, "saveTrack")) {
    try {
      const points = pointsFromFlat(message.points);
      setStatus(`Encoding ${points.length.toLocaleString("en-GB")} edited points in WebAssembly…`);
      const bytes = await encodeTrackWasm(points);
      const filename = safeDownloadName(message.suggestedName, "Sandsara-trackNumber-edited.bin");
      downloadBytes(bytes, filename);
      currentFilename = filename;
      pendingTrack = {
        type: "track",
        payload: payloadFromPoints(currentFilename, points, [])
      };
      deliverPendingTrack();
      setStatus(`Encoded and saved ${points.length.toLocaleString("en-GB")} points entirely in memory.`);
    } catch (error: unknown) {
      setStatus(`Could not save the edited track: ${errorMessage(error)}`, true);
    }
  }
});

input.addEventListener("change", () => {
  const file = input.files?.[0];
  if (file !== undefined) void loadTrack(file);
});

void import("../webview/trackPreview").catch((error: unknown) => {
  setStatus(`Could not start the track decoder: ${errorMessage(error)}`, true);
});

async function loadTrack(file: File): Promise<void> {
  try {
    setStatus(`Decoding ${file.name} in WebAssembly…`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const track = await decodeTrackWasm(bytes);
    currentFilename = file.name;
    pendingTrack = { type: "track", payload: createPayload(file.name, track) };
    deliverPendingTrack();
    setStatus(`Decoded ${track.points.length.toLocaleString("en-GB")} points from ${file.name} in memory.`);
  } catch (error: unknown) {
    pendingTrack = null;
    setStatus(`Could not decode the track: ${errorMessage(error)}`, true);
  }
}

function deliverPendingTrack(): void {
  if (!toolReady || pendingTrack === null) return;
  const outgoing = pendingTrack;
  pendingTrack = null;
  sendHostMessage(outgoing);
}

function createPayload(filename: string, track: DecodedSandsaraTrack): FlatTrackPayload {
  return {
    points: track.points.flatMap(point => [point.x, point.y]),
    pointCount: track.points.length,
    byteLength: track.byteLength,
    minX: track.minX,
    maxX: track.maxX,
    minY: track.minY,
    maxY: track.maxY,
    maximumRadius: track.maximumRadius,
    warnings: track.warnings,
    filename
  };
}

function payloadFromPoints(
  filename: string,
  points: readonly SandsaraPoint[],
  extraWarnings: readonly string[]
): FlatTrackPayload {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maximumRadius = 0;
  let outside = 0;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
    const radius = Math.hypot(point.x, point.y);
    maximumRadius = Math.max(maximumRadius, radius);
    if (radius > 32_768) outside++;
  }

  const warnings = [...extraWarnings];
  if (outside > 0) warnings.push(`${outside} points lie outside the nominal 32767-unit drawing radius.`);

  return {
    points: points.flatMap(point => [point.x, point.y]),
    pointCount: points.length,
    byteLength: points.length * 6,
    minX,
    maxX,
    minY,
    maxY,
    maximumRadius,
    warnings,
    filename
  };
}

function pointsFromFlat(values: readonly unknown[]): SandsaraPoint[] {
  if (values.length % 2 !== 0) throw new Error("The edited coordinate array has an unmatched value.");
  const points: SandsaraPoint[] = [];
  for (let index = 0; index < values.length; index += 2) {
    const rawX = values[index];
    const rawY = values[index + 1];
    if (typeof rawX !== "number" || typeof rawY !== "number") {
      throw new Error(`Point ${index / 2} does not contain two numbers.`);
    }
    const x = coordinate(rawX, "X", index / 2);
    const y = coordinate(rawY, "Y", index / 2);
    points.push({ x, y });
  }
  if (points.length < 2) throw new Error("A Sandsara track must contain at least two points.");
  return points;
}

function coordinate(value: number, axis: "X" | "Y", index: number): number {
  if (!Number.isInteger(value) || value < -32_768 || value > 32_767) {
    throw new Error(`${axis} coordinate ${index} must be a signed 16-bit integer.`);
  }
  return value;
}

function isTrackMessage(
  message: unknown,
  type: "editTrack"
): message is Extract<TrackPreviewWebviewMessage, { readonly type: "editTrack" }>;
function isTrackMessage(
  message: unknown,
  type: "saveTrack"
): message is Extract<TrackPreviewWebviewMessage, { readonly type: "saveTrack" }>;
function isTrackMessage(message: unknown, type: string): message is {
  readonly type: string;
  readonly points: readonly unknown[];
  readonly source: string;
  readonly suggestedName: string;
} {
  return isMsg(message, type) && Array.isArray(message.points) && typeof message.source === "string" &&
    (type !== "saveTrack" || typeof message.suggestedName === "string");
}
