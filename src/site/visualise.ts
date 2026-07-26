import { decodeSandsaraTrack } from "../sandsara";
import type {
  FlatTrackPayload,
  TrackPreviewHostMessage
} from "../webview/types";
import {
  errorMessage,
  installBrowserHost,
  isMessageType,
  requiredElement,
  sendHostMessage,
  setStatus
} from "./browserHost";

const input = requiredElement<HTMLInputElement>("binInput");
let toolReady = false;
let pendingTrack: TrackPreviewHostMessage | undefined;

installBrowserHost((message: unknown) => {
  if (isMessageType(message, "ready")) {
    toolReady = true;
    if (pendingTrack === undefined) {
      setStatus("Choose a Sandsara .bin file to inspect.");
    } else {
      deliverPendingTrack();
    }
  }
});

input.addEventListener("change", () => {
  const file = input.files?.[0];
  if (file !== undefined) {
    void loadTrack(file);
  }
});

void import("../webview/trackPreview").catch((error: unknown) => {
  setStatus(`Could not start the track preview: ${errorMessage(error)}`, true);
});

async function loadTrack(file: File): Promise<void> {
  try {
    setStatus(`Decoding ${file.name}…`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const track = decodeSandsaraTrack(bytes);
    pendingTrack = {
      type: "track",
      payload: createPayload(file.name, track)
    };
    deliverPendingTrack();
    setStatus(
      `Decoded ${track.points.length.toLocaleString("en-GB")} points from ${file.name}.`
    );
  } catch (error: unknown) {
    pendingTrack = undefined;
    setStatus(`Could not decode the track: ${errorMessage(error)}`, true);
  }
}

function deliverPendingTrack(): void {
  if (!toolReady || pendingTrack === undefined) {
    return;
  }

  const outgoing = pendingTrack;
  pendingTrack = undefined;
  sendHostMessage(outgoing);
}

function createPayload(
  filename: string,
  track: ReturnType<typeof decodeSandsaraTrack>
): FlatTrackPayload {
  const maximumPreviewPoints = 100_000;
  const stride = Math.max(1, Math.ceil(track.points.length / maximumPreviewPoints));
  const points: number[] = [];

  for (let index = 0; index < track.points.length; index += stride) {
    const point = track.points[index];
    if (point !== undefined) {
      points.push(point.x, point.y);
    }
  }

  const finalPoint = track.points.at(-1);
  if (
    finalPoint !== undefined &&
    (points.at(-2) !== finalPoint.x || points.at(-1) !== finalPoint.y)
  ) {
    points.push(finalPoint.x, finalPoint.y);
  }

  return {
    points,
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
