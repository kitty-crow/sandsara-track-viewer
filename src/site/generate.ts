import { encodeSandsaraTrack, pointsFromFlatArray } from "../sandsara";
import type { SvgToTrackHostMessage } from "../webview/types";
import {
  downloadBytes,
  errorMessage,
  installBrowserHost,
  isMessageType,
  requiredElement,
  sendHostMessage,
  setStatus
} from "./browserHost";

const input = requiredElement<HTMLInputElement>("svgInput");
const trackName = requiredElement<HTMLInputElement>("trackName");
const trackNumber = requiredElement<HTMLInputElement>("trackNumber");
const previewTitle = requiredElement<HTMLElement>("trackPreviewTitle");
const savePreview = requiredElement<HTMLButtonElement>("savePreview");
const progressPanel = requiredElement<HTMLElement>("trackProgress");
const progressStage = requiredElement<HTMLElement>("trackProgressStage");
const progressBar = requiredElement<HTMLProgressElement>("trackProgressBar");
const progressDetail = requiredElement<HTMLElement>("trackProgressDetail");
let toolReady = false;
let trackReady = false;
let pendingSvg: SvgToTrackHostMessage | undefined = pendingSvgFromSession();

initialiseTrackDetails(pendingSvg?.filename ?? "custom.svg");

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
    message.points.every(value => typeof value === "number")
  ) {
    try {
      const details = validatedTrackDetails();
      beginProgress("Preparing your download…", "Saving the finished track.");
      const points = pointsFromFlatArray(message.points);
      const encoded = encodeSandsaraTrack(points);
      downloadBytes(encoded, details.binFilename);
      completeProgress("Download ready", `Saved “${details.name}”.`);
      setStatus(`Downloaded “${details.name}”.`);
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

trackName.addEventListener("input", updatePreviewTitle);
trackNumber.addEventListener("input", normaliseTrackNumberInput);
savePreview.addEventListener("click", () => void downloadPreviewImage());
window.addEventListener("sandsara-routing-progress", event => {
  const detail = (event as CustomEvent<{
    readonly completedPaths: number;
    readonly totalPaths: number;
    readonly percentage: number;
    readonly etaText: string;
  }>).detail;
  if (detail === undefined) {
    return;
  }
  progressPanel.hidden = false;
  progressPanel.classList.remove("complete", "error");
  progressStage.textContent =
    `Tracing path ${detail.completedPaths.toLocaleString("en-GB")} of ${detail.totalPaths.toLocaleString("en-GB")}`;
  progressBar.value = detail.percentage;
  progressBar.textContent = `${detail.percentage}%`;
  progressDetail.textContent = detail.etaText;
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

    initialiseTrackDetails(file.name);
    trackReady = false;
    savePreview.disabled = true;
    beginProgress("Opening your drawing…", "Preparing it for the track builder.");
    setStatus("Opening your drawing…");
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
  setStatus("Creating your track…");

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
      trackReady = true;
      savePreview.disabled = false;
      completeProgress("Track ready", "Review the preview or download the .bin file.");
      setStatus("Track ready. Review the preview or download the .bin file.");
      return;
    }

    if (/failed|could not|no drawable|fewer than two/i.test(text)) {
      trackReady = false;
      savePreview.disabled = true;
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
      trackReady = false;
      savePreview.disabled = true;
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

async function downloadPreviewImage(): Promise<void> {
  try {
    if (!trackReady) {
      throw new Error("Wait for the track preview to finish.");
    }
    const details = validatedTrackDetails();
    const canvas = document.querySelector<HTMLCanvasElement>("#app #preview");
    if (canvas === null || canvas.width < 1 || canvas.height < 1) {
      throw new Error("The track preview is not ready.");
    }
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(result => {
        if (result === null) {
          reject(new Error("The preview image could not be created."));
        } else {
          resolve(result);
        }
      }, "image/png");
    });
    downloadBytes(new Uint8Array(await blob.arrayBuffer()), details.previewFilename);
    setStatus(`Downloaded the preview for “${details.name}”.`);
  } catch (error: unknown) {
    setStatus(`Could not save the preview: ${errorMessage(error)}`, true);
  }
}

function initialiseTrackDetails(filename: string): void {
  const stem = filename.replace(/\.[^.]+$/, "");
  const readable = stem
    .replace(/(?:-vectorised|_vectorised)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  trackName.value = readable.length > 0 ? readable : "Custom pattern";
  trackNumber.value = String(suggestedTrackNumber(stem)).padStart(4, "0");
  updatePreviewTitle();
}

function suggestedTrackNumber(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return 9000 + (Math.abs(hash) % 1000);
}

function normaliseTrackNumberInput(): void {
  trackNumber.value = trackNumber.value.replace(/\D/g, "").slice(0, 4);
}

function updatePreviewTitle(): void {
  const name = trackName.value.trim();
  previewTitle.textContent = name.length > 0 ? `Track preview · ${name}` : "Track preview";
}

function validatedTrackDetails(): {
  readonly name: string;
  readonly binFilename: string;
  readonly previewFilename: string;
} {
  const name = trackName.value.trim();
  if (name.length === 0) {
    trackName.focus();
    throw new Error("Enter a track name.");
  }

  const rawNumber = trackNumber.value.trim();
  if (!/^\d{1,4}$/.test(rawNumber)) {
    trackNumber.focus();
    throw new Error("Enter a track number from 0000 to 9999.");
  }
  const number = Number.parseInt(rawNumber, 10);
  if (!Number.isInteger(number) || number < 0 || number > 9999) {
    throw new Error("Enter a track number from 0000 to 9999.");
  }
  const padded = String(number).padStart(4, "0");
  const base = `Sandsara-trackNumber-${padded}`;
  return {
    name,
    binFilename: `${base}.bin`,
    previewFilename: `${base}-preview.png`
  };
}

function beginProgress(stage: string, detail: string): void {
  progressPanel.hidden = false;
  progressStage.textContent = stage;
  progressDetail.textContent = detail;
  progressBar.removeAttribute("value");
  progressBar.textContent = "Working";
  progressPanel.classList.remove("complete", "error");
}

function completeProgress(stage: string, detail: string): void {
  progressPanel.hidden = false;
  progressStage.textContent = stage;
  progressDetail.textContent = detail;
  progressBar.value = 100;
  progressBar.textContent = "Complete";
  progressPanel.classList.remove("error");
  progressPanel.classList.add("complete");
}

function failProgress(stage: string, detail: string): void {
  progressPanel.hidden = false;
  progressStage.textContent = stage;
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
