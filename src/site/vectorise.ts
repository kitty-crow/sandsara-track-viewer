import type { ImageVectoriserHostMessage } from "../webview/types";
import {
  downloadText,
  errorMessage,
  installBrowserHost,
  isMessageType,
  requiredElement,
  safeDownloadName,
  sendHostMessage,
  setStatus
} from "./browserHost";

const input = requiredElement<HTMLInputElement>("imageInput");
const continueLink = requiredElement<HTMLAnchorElement>("continueLink");
const progressPanel = requiredElement<HTMLElement>("processingProgress");
const progressBar = requiredElement<HTMLProgressElement>("processingProgressBar");
const progressPercent = requiredElement<HTMLElement>("processingProgressPercent");
const progressStage = requiredElement<HTMLElement>("processingProgressStage");
const progressTiming = requiredElement<HTMLElement>("processingProgressTiming");
const cancelButton = requiredElement<HTMLButtonElement>("cancelProcessing");
const app = requiredElement<HTMLElement>("app");

let toolReady = false;
let pendingImage: ImageVectoriserHostMessage | undefined;
let currentReader: FileReader | undefined;
let activeRun = 0;
let startedAt = 0;
let estimatedDuration = 8_000;
let progressTimer: number | undefined;
let completionObserver: MutationObserver | undefined;

installBrowserHost(async (message: unknown) => {
  if (isMessageType(message, "ready")) {
    toolReady = true;
    if (pendingImage === undefined) {
      setStatus("Choose an image to begin.");
    } else {
      deliverPendingImage();
    }
    return;
  }

  if (
    isMessageType(message, "saveSvg") &&
    typeof message.svg === "string" &&
    typeof message.suggestedName === "string"
  ) {
    const filename = safeDownloadName(message.suggestedName, "vectorised.svg");
    downloadText(message.svg, filename, "image/svg+xml;charset=utf-8");
    sessionStorage.setItem("sandsara.pendingSvg", message.svg);
    sessionStorage.setItem("sandsara.pendingSvgFilename", filename);
    continueLink.hidden = false;
    setStatus(`Downloaded ${filename}. Continue to the track generator when ready.`);
    return;
  }

  if (isMessageType(message, "showError") && typeof message.message === "string") {
    stopProgress(false);
    setStatus(message.message, true);
  }
});

input.addEventListener("change", () => {
  const file = input.files?.[0];
  if (file !== undefined) {
    void loadImage(file);
  }
});

cancelButton.addEventListener("click", cancelCurrentRun);
installDropTarget(input, file => void loadImage(file));

void import("../webview/imageVectoriser").catch((error: unknown) => {
  setStatus(`Could not start the vectoriser: ${errorMessage(error)}`, true);
});

async function loadImage(file: File): Promise<void> {
  const run = ++activeRun;
  try {
    if (!file.type.startsWith("image/") && !/\.(png|jpe?g|bmp|webp|gif)$/i.test(file.name)) {
      throw new Error("Choose a PNG, JPEG, BMP, WebP or GIF image.");
    }

    cancelCurrentWorkOnly();
    continueLink.hidden = true;
    startedAt = performance.now();
    estimatedDuration = estimateDuration(file.size);
    showProgress("Reading image from this device…", 0);
    setStatus(`Reading ${file.name} locally…`);

    const dataUri = await readFileWithProgress(file, run);
    if (run !== activeRun) {
      return;
    }

    showProgress("Image loaded. Waiting for the vectoriser…", 20);
    pendingImage = {
      type: "initialiseImage",
      dataUri,
      filename: file.name
    };
    deliverPendingImage();
  } catch (error: unknown) {
    if (run !== activeRun) {
      return;
    }
    stopProgress(false);
    setStatus(`Could not read the image: ${errorMessage(error)}`, true);
  }
}

function deliverPendingImage(): void {
  if (!toolReady || pendingImage === undefined) {
    return;
  }

  const outgoing = pendingImage;
  pendingImage = undefined;
  sendHostMessage(outgoing);
  setStatus(`Processing ${outgoing.filename} entirely on this device.`);
  startProcessingProgress();
  watchForCompletion();
}

function readFileWithProgress(file: File, run: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    currentReader = reader;

    reader.addEventListener("progress", event => {
      if (run !== activeRun || !event.lengthComputable) {
        return;
      }
      showProgress("Reading image from this device…", 20 * event.loaded / event.total);
    });
    reader.addEventListener("load", () => {
      currentReader = undefined;
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("The browser did not return an image data URL."));
      }
    });
    reader.addEventListener("abort", () => reject(new Error("Image processing was cancelled.")));
    reader.addEventListener("error", () => {
      currentReader = undefined;
      reject(reader.error ?? new Error("The selected file could not be read."));
    });
    reader.readAsDataURL(file);
  });
}

function startProcessingProgress(): void {
  if (progressTimer !== undefined) {
    window.clearInterval(progressTimer);
  }

  progressTimer = window.setInterval(() => {
    const elapsed = performance.now() - startedAt;
    const fraction = Math.min(0.985, elapsed / estimatedDuration);
    const percent = 20 + fraction * 75;
    const stage = processingStage(percent);
    const remaining = Math.max(0, estimatedDuration - elapsed);
    showProgress(stage, percent, remaining);
  }, 160);
}

function watchForCompletion(): void {
  completionObserver?.disconnect();
  completionObserver = new MutationObserver(() => {
    const text = app.textContent ?? "";
    if (/vector points|vector lines/i.test(text) && !/Processing/i.test(text)) {
      showProgress("Rendering complete.", 100, 0);
      stopProgress(true);
      setStatus("Image loaded and vectorised locally. Adjust the controls or save the SVG.");
    }
  });
  completionObserver.observe(app, { subtree: true, childList: true, characterData: true });
}

function processingStage(percent: number): string {
  if (percent < 30) return "Decoding the image…";
  if (percent < 40) return "Resizing to the processing resolution…";
  if (percent < 52) return "Converting to greyscale and increasing contrast…";
  if (percent < 62) return "Reducing image noise…";
  if (percent < 75) return "Detecting edges and contours…";
  if (percent < 87) return "Tracing continuous vector lines…";
  if (percent < 95) return "Simplifying and filtering paths…";
  return "Rendering the vector preview…";
}

function showProgress(stage: string, percent: number, remaining?: number): void {
  const safePercent = Math.max(0, Math.min(100, percent));
  progressPanel.hidden = false;
  progressBar.value = safePercent;
  progressPercent.textContent = `${Math.round(safePercent)}%`;
  progressStage.textContent = stage;

  const elapsed = Math.max(0, performance.now() - startedAt);
  const elapsedText = formatDuration(elapsed);
  const etaText = remaining === undefined || safePercent < 2
    ? "Estimating remaining time…"
    : safePercent >= 100
      ? `Completed in ${elapsedText}`
      : `Elapsed ${elapsedText} · about ${formatDuration(remaining)} remaining`;
  progressTiming.textContent = etaText;
}

function stopProgress(completed: boolean): void {
  if (progressTimer !== undefined) {
    window.clearInterval(progressTimer);
    progressTimer = undefined;
  }
  completionObserver?.disconnect();
  completionObserver = undefined;
  cancelButton.disabled = completed;
}

function cancelCurrentRun(): void {
  activeRun++;
  cancelCurrentWorkOnly();
  pendingImage = undefined;
  stopProgress(false);
  progressPanel.hidden = true;
  setStatus("Image processing cancelled.");
}

function cancelCurrentWorkOnly(): void {
  currentReader?.abort();
  currentReader = undefined;
  if (progressTimer !== undefined) {
    window.clearInterval(progressTimer);
    progressTimer = undefined;
  }
  completionObserver?.disconnect();
  completionObserver = undefined;
  cancelButton.disabled = false;
}

function estimateDuration(bytes: number): number {
  const megabytes = bytes / 1_048_576;
  return Math.max(4_000, Math.min(45_000, 4_000 + megabytes * 1_350));
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
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
