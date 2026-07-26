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
      beginProgress("Encoding the .bin file…", "Writing Sandsara coordinate records in this browser.");
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
      failProgress("Encoding failed", errorMessage(error));
      setStatus(`Could not encode the track: ${errorMessage(error)}`, true);
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
    failProgress("Generator failed to start", errorMessage(error));
    setStatus(`Could not start the track generator: ${errorMessage(error)}`, true);
  });

async function loadSvg(file: File): Promise<void> {
  try {
    if (!/\.svg$/i.test(file.name) && file.type !== "image/svg+xml") {
      throw new Error("Choose an SVG file.");
    }

    beginProgress("Reading the SVG…", file.name);
    setStatus(`Reading ${file.name}…`);
    pendingSvg = {
      type: "initialiseSvg",
      svg: await file.text(),
      filename: file.name
    };
    deliverPendingSvg();
  } catch (error: unknown) {
    failProgress("Could not read the SVG", errorMessage(error));
    setStatus(`Could not read the SVG: ${errorMessage(error)}`, true);
  }
}

function deliverPendingSvg(): void {
  if (!toolReady || pendingSvg === undefined) {
    return;
  }

  const outgoing = pendingSvg;
  pendingSvg = undefined;
  beginProgress(
    "Generating the Sandsara track…",
    "Sampling the vector paths, joining them and spacing the ball positions."
  );
  setStatus(`Generating and previewing ${outgoing.filename} entirely in this browser.`);

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
      setStatus("Track ready. Review the preview or save the .bin file.");
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
        "Regenerating the track…",
        "Applying the updated spacing, simplification and circular fit."
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
