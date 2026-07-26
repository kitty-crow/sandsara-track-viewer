export interface BrowserVsCodeApi<State = unknown> {
  postMessage(message: unknown): void;
  getState(): State | undefined;
  setState(state: State): void;
}

export type BrowserMessageHandler = (message: unknown) => void | Promise<void>;

export function installBrowserHost(handler: BrowserMessageHandler): void {
  let state: unknown;
  const target = globalThis as typeof globalThis & {
    acquireVsCodeApi: () => BrowserVsCodeApi;
  };

  target.acquireVsCodeApi = () => ({
    postMessage(message: unknown): void {
      void Promise.resolve(handler(message)).catch(error => {
        console.error("Sandsara browser host message failed", error);
      });
    },
    getState(): unknown {
      return state;
    },
    setState(nextState: unknown): void {
      state = nextState;
    }
  });
}

export function sendHostMessage(message: unknown): void {
  window.dispatchEvent(new MessageEvent("message", { data: message }));
}

export function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing page element: ${id}`);
  }
  return element as T;
}

export function isMessageType(
  value: unknown,
  type: string
): value is Record<string, unknown> & { readonly type: string } {
  return typeof value === "object" && value !== null &&
    "type" in value && value.type === type;
}

export function setStatus(message: string, isError = false): void {
  const status = document.getElementById("siteStatus");
  if (status === null) {
    return;
  }

  status.textContent = message;
  status.classList.toggle("error", isError);
}

export async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("The browser did not return an image data URL."));
      }
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("The selected file could not be read."));
    });
    reader.readAsDataURL(file);
  });
}

export function downloadText(
  text: string,
  filename: string,
  mimeType: string
): void {
  downloadBlob(new Blob([text], { type: mimeType }), filename);
}

export function downloadBytes(
  bytes: Uint8Array,
  filename: string,
  mimeType = "application/octet-stream"
): void {
  const copied = new Uint8Array(bytes.byteLength);
  copied.set(bytes);
  downloadBlob(new Blob([copied], { type: mimeType }), filename);
}

export function safeDownloadName(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return fallback;
  }

  return trimmed.replace(/[\\/:*?"<>|\u0000-\u001F]/g, "-");
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
