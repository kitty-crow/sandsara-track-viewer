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
const progressPanel = requiredElement<HTMLElement>("trackProgress");
const progressStage = requiredElement<HTMLElement>("trackProgressStage");
const progressPercent = requiredElement<HTMLElement>("trackProgressPercent");
const progressBar = requiredElement<HTMLProgressElement>("trackProgressBar");
const progressDetail = requiredElement<HTMLElement>("trackProgressDetail");
let toolReady = false;
let pendingSvg: SvgToTrackHostMessage | undefined = pendingSvgFromSession();

installBrowserHost(async (message: unknown) => {
  if (isMessageType(message, "ready")) {
    toolReady = true;
    if (pendingSvg === undefined) {
      setStatus("Choose a drawing to create a Sandsara track.");
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
      beginProgress("Preparing the download…", "Saving your track as a Sandsara .bin file.");
      const points = pointsFromFlatArray(message.points);
      const encoded = encodeSandsaraTrack(points);
      const filename = safeDownloadName(
        message.suggestedName,
        "Sandsara-trackNumber-custom.bin"
      );
      downloadBytes(encoded, filename);
      completeProgress(
        "Track downloaded",
        `${points.length.toLocaleString("en-GB")} points · ${encoded.byteLength.toLocaleString("en-GB")} bytes`
      );
      setStatus(
        `Downloaded ${filename} with ${points.length.toLocaleString("en-GB")} points.`
      );
    } catch (error: unknown) {
      failProgress("Download failed", errorMessage(error));
      setStatus(`Could not save the track: ${errorMessage(error)}`, true);
    }
    return;
  }

  if (isMessageType(message, "showError") && typeof message.message === "string") {
    failProgress("Track generation failed", message.message);
    setStatus(message.message, true);
  }
});

input.addEventListener("change", () => {
  const file = input.files?.[0];
  if (file !== undefined) {
    void loadSvg(file);
  }
});

installDropTarget(input, file => void loadSvg(file));

void import("../webview/svgToTrack")
  .then(() => installGeneratorProgress())
  .catch((error: unknown) => {
    failProgress("The track builder could not start", errorMessage(error));
    setStatus(`The track builder could not start: ${errorMessage(error)}`, true);
  });

async function loadSvg(file: File): Promise<void> {
  try {
    if (!/\.svg$/i.test(file.name) && file.type !== "image/svg+xml") {
      throw new Error("Choose an SVG file.");
    }

    beginProgress("Opening the drawing…", file.name);
    setStatus(`Opening ${file.name}…`);
    pendingSvg = {
      type: "initialiseSvg",
      svg: await file.text(),
      filename: file.name
    };
    deliverPendingSvg();
  } catch (error: unknown) {
    failProgress("Could not open the drawing", errorMessage(error));
    setStatus(`Could not open the drawing: ${errorMessage(error)}`, true);
  }
}

function deliverPendingSvg(): void {
  if (!toolReady || pendingSvg === undefined) {
    return;
  }

  const outgoing = pendingSvg;
  pendingSvg = undefined;
  beginProgress(
    "Creating your track…",
    "Tracing the lines, joining the paths and preparing the preview."
  );
  setStatus(`Creating a track from ${outgoing.filename}…`);

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => sendHostMessage(outgoing));
  });
}

function installGeneratorProgress(): void {
  const stats = document.getElementById("stats");
  if (stats === null) {
    throw new Error("The generator status display is missing.");
  }

  const updateFromStats = (): void => {
    const text = stats.textContent?.trim() ?? "";
    if (text.includes("Sandsara points")) {
      completeProgress("Track ready", text);
      setStatus("Track ready. Review the preview or download the .bin file.");
      return;
    }

    if (/failed|could not|no drawable|fewer than two/i.test(text)) {
      failProgress("Track generation failed", text);
    }
  };

  new MutationObserver(updateFromStats).observe(stats, {
    childList: true,
    subtree: true,
    characterData: true
  });

  for (const id of ["sampleSpacing", "simplify", "trackSpacing", "padding", "edgeEntry"]) {
    const control = document.getElementById(id);
    if (control === null) {
      continue;
    }

    const markRegeneration = (): void => {
      beginProgress(
        "Updating your track…",
        "Applying your changes and rebuilding the preview."
      );
    };
    control.addEventListener("input", markRegeneration);
    control.addEventListener("change", markRegeneration);
  }

  updateFromStats();
}

function beginProgress(stage: string, detail: string): void {
  progressPanel.hidden = false;
  progressStage.textContent = stage;
  progressPercent.textContent = "Working…";
  progressDetail.textContent = detail;
  progressBar.removeAttribute("value");
  progressBar.textContent = "Working";
  progressPanel.classList.remove("complete", "error");
}

function completeProgress(stage: string, detail: string): void {
  progressPanel.hidden = false;
  progressStage.textContent = stage;
  progressPercent.textContent = "100%";
  progressDetail.textContent = detail;
  progressBar.value = 100;
  progressBar.textContent = "100%";
  progressPanel.classList.remove("error");
  progressPanel.classList.add("complete");
}

function failProgress(stage: string, detail: string): void {
  progressPanel.hidden = false;
  progressStage.textContent = stage;
  progressPercent.textContent = "Stopped";
  progressDetail.textContent = detail;
  progressBar.value = 0;
  progressBar.textContent = "Stopped";
  progressPanel.classList.remove("complete");
  progressPanel.classList.add("error");
}

function pendingSvgFromSession(): SvgToTrackHostMessage | undefined {
  const svg = sessionStorage.getItem("sandsara.pendingSvg");
  if (svg === null) {
    return undefined;
  }

  const filename = sessionStorage.getItem("sandsara.pendingSvgFilename") ?? "vectorised.svg";
  sessionStorage.removeItem("sandsara.pendingSvg");
  sessionStorage.removeItem("sandsara.pendingSvgFilename");
  return {
    type: "initialiseSvg",
    svg,
    filename
  };
}

function installDropTarget(
  fileInput: HTMLInputElement,
  onFile: (file: File) => void
): void {
  const panel = fileInput.closest<HTMLElement>(".upload-panel");
  if (panel === null) {
    return;
  }

  for (const eventName of ["dragenter", "dragover"]) {
    panel.addEventListener(eventName, event => {
      event.preventDefault();
      panel.classList.add("drag-active");
    });
  }

  for (const eventName of ["dragleave", "drop"]) {
    panel.addEventListener(eventName, event => {
      event.preventDefault();
      panel.classList.remove("drag-active");
    });
  }

  panel.addEventListener("drop", event => {
    const file = event.dataTransfer?.files[0];
    if (file !== undefined) {
      onFile(file);
    }
  });
}
