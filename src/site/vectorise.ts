import type { ImageVectoriserHostMessage } from "../webview/types.js";
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
} from "./browserHost.js";

const input = requiredElement<HTMLInputElement>("imageInput");
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
    setStatus(`Downloaded ${filename}.`);
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

void import("../webview/imageVectoriser.js").catch((error: unknown) => {
  setStatus(`Could not start the vectoriser: ${errorMessage(error)}`, true);
});

async function loadImage(file: File): Promise<void> {
  try {
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
