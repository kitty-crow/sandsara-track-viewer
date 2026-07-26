import type { ImageVectoriserHostMessage } from "../webview/types";
import {
  downloadText,
  errorMessage,
  installBrowserHost,
  isMessageType,
  readFileAsDataUrl,
  requiredElement,
  safeDownloadName,
  sendHostMessage,
  setStatus
} from "./browserHost";

const input = requiredElement<HTMLInputElement>("imageInput");
const continueLink = requiredElement<HTMLAnchorElement>("continueLink");
let toolReady = false;
let pendingImage: ImageVectoriserHostMessage | undefined;

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
    setStatus(message.message, true);
  }
});

input.addEventListener("change", () => {
  const file = input.files?.[0];
  if (file !== undefined) {
    void loadImage(file);
  }
});

installDropTarget(input, file => void loadImage(file));

void import("../webview/imageVectoriser").catch((error: unknown) => {
  setStatus(`Could not start the vectoriser: ${errorMessage(error)}`, true);
});

async function loadImage(file: File): Promise<void> {
  try {
    if (!file.type.startsWith("image/") && !/\.(png|jpe?g|bmp|webp|gif)$/i.test(file.name)) {
      throw new Error("Choose a PNG, JPEG, BMP, WebP or GIF image.");
    }

    continueLink.hidden = true;
    setStatus(`Loading ${file.name}…`);
    const dataUri = await readFileAsDataUrl(file);
    pendingImage = {
      type: "initialiseImage",
      dataUri,
      filename: file.name
    };
    deliverPendingImage();
  } catch (error: unknown) {
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
  setStatus(`Vectorising ${outgoing.filename} entirely in this browser.`);
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
