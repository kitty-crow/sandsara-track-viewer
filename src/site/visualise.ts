import "./trackMarked";
import type { DecodedSandsaraTrack, SandsaraPoint } from "../sandsara";
import type {
  FlatTrackPayload,
  TrackEditorState,
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
  sendHostMessage
} from "./browserHost";
import { decodeTrackWasm, encodeTrackWasm } from "./trackCodecWasm";

interface DirtyDetail {
  readonly dirty: boolean;
}

const input = requiredElement<HTMLInputElement>("binInput");
const queue: TrackPreviewHostMessage[] = [];
const openRequest: Extract<TrackPreviewWebviewMessage, { readonly type: "openTrack" }> = { type: "openTrack" };
let ready = false;
let filename = "Sandsara-trackNumber-edited.bin";
let original: SandsaraPoint[] = [];
let dirty = false;

window.addEventListener("sandsara-track-dirty", event => {
  dirty = (event as CustomEvent<DirtyDetail>).detail.dirty;
});

installBrowserHost(async (message: unknown) => {
  if (isMsg(message, "ready")) {
    ready = true;
    flush();
    if (original.length === 0) state("empty", "Open a Sandsara .bin track to begin.");
    return;
  }

  if (isMsg(message, openRequest.type)) {
    if (dirty && !window.confirm("Discard the unsaved track edits and open another file?")) return;
    input.click();
    return;
  }

  if (isTrackMessage(message, "editTrack")) {
    try {
      const points = pointsFromFlat(message.points);
      emit({
        type: "track",
        payload: payloadFromPoints(filename, points, []),
        resetOriginal: false
      });
      state("dirty", `Applied ${points.length.toLocaleString("en-GB")} edited points to the in-memory preview. Changes remain unsaved.`);
    } catch (error: unknown) {
      state("invalid", `Could not apply the edited track: ${errorMessage(error)}`);
    }
    return;
  }

  if (isTrackMessage(message, "saveTrack")) {
    const points = pointsFromFlat(message.points);
    state("saving", `Encoding ${points.length.toLocaleString("en-GB")} edited points in WebAssembly…`);
    try {
      const bytes = await encodeTrackWasm(points);
      const nextName = safeDownloadName(message.suggestedName, "Sandsara-trackNumber-edited.bin");
      downloadBytes(bytes, nextName);
      filename = nextName;
      original = clone(points);
      dirty = false;
      emit({
        type: "accepted",
        filename,
        message: `Encoded and saved ${points.length.toLocaleString("en-GB")} points. The edited track remains loaded.`
      });
    } catch (error: unknown) {
      state("dirty", `Could not save the edited track: ${errorMessage(error)} Unsaved changes are still in memory.`);
    }
    return;
  }

  if (isMsg(message, "resetTrack")) {
    if (original.length < 2) {
      state("invalid", "There is no original track to restore.");
      return;
    }
    state("loading", "Restoring the originally loaded track…");
    const points = clone(original);
    dirty = false;
    emit({
      type: "track",
      payload: payloadFromPoints(filename, points, []),
      resetOriginal: true
    });
    state("saved", "Restored the originally loaded track in memory.");
  }
});

input.addEventListener("change", () => {
  const file = input.files?.[0];
  if (file !== undefined) void load(file);
});

void import("../webview/trackPreview").catch((error: unknown) => {
  state("invalid", `Could not start the track editor: ${errorMessage(error)}`);
});

async function load(file: File): Promise<void> {
  state("loading", `Decoding ${file.name} in WebAssembly…`);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const track = await decodeTrackWasm(bytes);
    filename = file.name;
    original = clone(track.points);
    dirty = false;
    emit({
      type: "track",
      payload: createPayload(file.name, track),
      resetOriginal: true
    });
    state("saved", `Decoded ${track.points.length.toLocaleString("en-GB")} points from ${file.name}.`);
  } catch (error: unknown) {
    state("invalid", `Could not decode the track: ${errorMessage(error)}`);
  } finally {
    input.value = "";
  }
}

function emit(message: TrackPreviewHostMessage): void {
  if (ready) sendHostMessage(message);
  else queue.push(message);
}

function state(next: TrackEditorState, message: string): void {
  emit({ type: "state", state: next, message });
}

function flush(): void {
  while (queue.length > 0) {
    const message = queue.shift();
    if (message !== undefined) sendHostMessage(message);
  }
}

function createPayload(name: string, track: DecodedSandsaraTrack): FlatTrackPayload {
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
    filename: name
  };
}

function payloadFromPoints(
  name: string,
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
    filename: name
  };
}

function pointsFromFlat(values: readonly unknown[]): SandsaraPoint[] {
  if (values.length % 2 !== 0) throw new Error("The edited coordinate array has an unmatched value.");
  const points: SandsaraPoint[] = [];
  for (let index = 0; index < values.length; index += 2) {
    const rawX = values[index];
    const rawY = values[index + 1];
    if (typeof rawX !== "number" || typeof rawY !== "number") throw new Error(`Point ${index / 2} does not contain two numbers.`);
    points.push({
      x: coordinate(rawX, "X", index / 2),
      y: coordinate(rawY, "Y", index / 2)
    });
  }
  if (points.length < 2) throw new Error("A Sandsara track must contain at least two points.");
  return points;
}

function coordinate(value: number, axis: "X" | "Y", index: number): number {
  if (!Number.isInteger(value) || value < -32_768 || value > 32_767) throw new Error(`${axis} coordinate ${index} must be a signed 16-bit integer.`);
  return value;
}

function clone(points: readonly SandsaraPoint[]): SandsaraPoint[] {
  return points.map(point => ({ x: point.x, y: point.y }));
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
