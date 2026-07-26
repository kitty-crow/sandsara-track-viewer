import { encodeSandsaraTrack, pointsFromFlatArray } from "../sandsara";
import type { SvgToTrackHostMessage } from "../webview/types";
import {
  downloadBytes,
  errorMessage,
  installBrowserHost,
  isMessageType,
  requiredElement,
  safeDownloadName,
  sendHostMessage,
  setStatus
} from "./browserHost";

const input = requiredElement<HTMLInputElement>("svgInput");
let toolReady = false;
let pendingSvg: SvgToTrackHostMessage | undefined;

installBrowserHost(async (message: unknown) => {
  if (isMessageType(message, "ready")) {
    toolReady = true;
    if (pendingSvg === undefined) {
      setStatus("Choose an SVG to generate a Sandsara track.");
    } else {
      deliverPendingSvg();
    }
    return;
  }

  if (
    isMessageType(message, "saveTrack") &&
    Array.isArray(message.points) &&
    message.points.every(value => typeof value === "number") &&
    typeof message.suggestedName === "string"
  ) {
    try {
      const points = pointsFromFlatArray(message.points);
      const encoded = encodeSandsaraTrack(points);
      const filename = safeDownloadName(
        message.suggestedName,
        "Sandsara-trackNumber-custom.bin"
      );
      downloadBytes(encoded, filename);
      setStatus(
        `Downloaded ${filename} with ${points.length.toLocaleString("en-GB")} points.`
      );
    } catch (error: unknown) {
      setStatus(`Could not encode the track: ${errorMessage(error)}`, true);
    }
    return;
  }

  if (isMessageType(message, "showError") && typeof message.message === "string") {
    setStatus(message.message, true);
  }
});

input.addEventListener("change", () => {
  const file = input.files?.[0];
  if (file !== undefined) {
    void loadSvg(file);
  }
});

void import("../webview/svgToTrack").catch((error: unknown) => {
  setStatus(`Could not start the track generator: ${errorMessage(error)}`, true);
});

async function loadSvg(file: File): Promise<void> {
  try {
    setStatus(`Reading ${file.name}…`);
    pendingSvg = {
      type: "initialiseSvg",
      svg: await file.text(),
      filename: file.name
    };
    deliverPendingSvg();
  } catch (error: unknown) {
    setStatus(`Could not read the SVG: ${errorMessage(error)}`, true);
  }
}

function deliverPendingSvg(): void {
  if (!toolReady || pendingSvg === undefined) {
    return;
  }

  const outgoing = pendingSvg;
  pendingSvg = undefined;
  sendHostMessage(outgoing);
  setStatus(`Generating and previewing ${outgoing.filename} entirely in this browser.`);
}
