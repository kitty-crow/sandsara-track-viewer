import type { ImageVectoriserHostMessage } from "../webview/types";
import { Drop, Files, Host, UI } from "./browserHost";

class Eta {
  private readonly box = UI.el<HTMLElement>("processingProgress");
  private readonly bar = UI.el<HTMLProgressElement>("processingProgressBar");
  private readonly pct = UI.el<HTMLElement>("processingProgressPercent");
  private readonly stage = UI.el<HTMLElement>("processingProgressStage");
  private readonly time = UI.el<HTMLElement>("processingProgressTiming");
  private readonly cancel = UI.el<HTMLButtonElement>("cancelProcessing");
  private start = 0;
  private est = 8_000;
  private tick: number | undefined;
  private obs: MutationObserver | undefined;

  constructor(private readonly app: HTMLElement) {}

  begin(bytes: number): void {
    this.stop(false);
    this.start = performance.now();
    this.est = Math.max(4_000, Math.min(45_000, 4_000 + bytes / 1_048_576 * 1_350));
    this.show("Reading image from this device…", 0);
  }

  process(done: () => void): void {
    this.tick = window.setInterval(() => {
      const elapsed = performance.now() - this.start;
      const pct = 20 + Math.min(.985, elapsed / this.est) * 75;
      this.show(this.label(pct), pct, Math.max(0, this.est - elapsed));
    }, 160);

    this.obs?.disconnect();
    this.obs = new MutationObserver(() => {
      const text = this.app.textContent ?? "";
      if (/vector points|vector lines/i.test(text) && !/Processing/i.test(text)) {
        this.show("Rendering complete.", 100, 0);
        this.stop(true);
        done();
      }
    });
    this.obs.observe(this.app, { subtree: true, childList: true, characterData: true });
  }

  read(pct: number): void { this.show("Reading image from this device…", pct); }
  loaded(): void { this.show("Image loaded. Waiting for the vectoriser…", 20); }
  hide(): void { this.box.hidden = true; }

  stop(done: boolean): void {
    if (this.tick !== undefined) window.clearInterval(this.tick);
    this.tick = undefined;
    this.obs?.disconnect();
    this.obs = undefined;
    this.cancel.disabled = done;
  }

  onCancel(fn: () => void): void { this.cancel.addEventListener("click", fn); }

  private show(label: string, value: number, left?: number): void {
    const n = Math.max(0, Math.min(100, value));
    this.box.hidden = false;
    this.bar.value = n;
    this.pct.textContent = `${Math.round(n)}%`;
    this.stage.textContent = label;
    const elapsed = performance.now() - this.start;
    this.time.textContent = left === undefined || n < 2
      ? "Estimating remaining time…"
      : n >= 100
        ? `Completed in ${this.dur(elapsed)}`
        : `Elapsed ${this.dur(elapsed)} · about ${this.dur(left)} remaining`;
  }

  private label(n: number): string {
    if (n < 30) return "Decoding the image…";
    if (n < 40) return "Resizing to the processing resolution…";
    if (n < 52) return "Converting to greyscale and increasing contrast…";
    if (n < 62) return "Reducing image noise…";
    if (n < 75) return "Detecting edges and contours…";
    if (n < 87) return "Tracing continuous vector lines…";
    if (n < 95) return "Simplifying and filtering paths…";
    return "Rendering the vector preview…";
  }

  private dur(ms: number): string {
    const sec = Math.max(0, Math.round(ms / 1_000));
    return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
  }
}

class VecApp {
  private readonly input = UI.el<HTMLInputElement>("imageInput");
  private readonly next = UI.el<HTMLAnchorElement>("continueLink");
  private readonly app = UI.el<HTMLElement>("app");
  private readonly host = new Host(msg => this.msg(msg));
  private readonly eta = new Eta(this.app);
  private ready = false;
  private pending: ImageVectoriserHostMessage | undefined;
  private reader: FileReader | undefined;
  private runId = 0;

  run(): void {
    this.host.init();
    this.input.addEventListener("change", () => {
      const file = this.input.files?.[0];
      if (file !== undefined) void this.load(file);
    });
    this.eta.onCancel(() => this.cancel());
    new Drop(this.input, file => void this.load(file)).init();
    void import("../webview/imageVectoriser").catch(err => UI.note(`Could not start the vectoriser: ${UI.err(err)}`, true));
  }

  private async msg(msg: unknown): Promise<void> {
    if (UI.is(msg, "ready")) {
      this.ready = true;
      this.pending === undefined ? UI.note("Choose an image to begin.") : this.send();
      return;
    }

    if (UI.is(msg, "saveSvg") && typeof msg.svg === "string" && typeof msg.suggestedName === "string") {
      const name = Files.name(msg.suggestedName, "vectorised.svg");
      Files.text(msg.svg, name, "image/svg+xml;charset=utf-8");
      sessionStorage.setItem("sandsara.pendingSvg", msg.svg);
      sessionStorage.setItem("sandsara.pendingSvgFilename", name);
      this.next.hidden = false;
      UI.note(`Downloaded ${name}. Continue to the track generator when ready.`);
      return;
    }

    if (UI.is(msg, "showError") && typeof msg.message === "string") {
      this.eta.stop(false);
      UI.note(msg.message, true);
    }
  }

  private async load(file: File): Promise<void> {
    const id = ++this.runId;
    try {
      if (!file.type.startsWith("image/") && !/\.(png|jpe?g|bmp|webp|gif)$/i.test(file.name)) {
        throw new Error("Choose a PNG, JPEG, BMP, WebP or GIF image.");
      }
      this.clear();
      this.next.hidden = true;
      this.eta.begin(file.size);
      UI.note(`Reading ${file.name} locally…`);
      const dataUri = await this.read(file, id);
      if (id !== this.runId) return;
      this.eta.loaded();
      this.pending = { type: "initialiseImage", dataUri, filename: file.name };
      this.send();
    } catch (err: unknown) {
      if (id !== this.runId) return;
      this.eta.stop(false);
      UI.note(`Could not read the image: ${UI.err(err)}`, true);
    }
  }

  private send(): void {
    if (!this.ready || this.pending === undefined) return;
    const msg = this.pending;
    this.pending = undefined;
    this.host.send(msg);
    UI.note(`Processing ${msg.filename} entirely on this device.`);
    this.eta.process(() => UI.note("Image loaded and vectorised locally. Adjust the controls or save the SVG."));
  }

  private read(file: File, id: number): Promise<string> {
    return new Promise<string>((ok, fail) => {
      const rd = new FileReader();
      this.reader = rd;
      rd.addEventListener("progress", e => {
        if (id === this.runId && e.lengthComputable) this.eta.read(20 * e.loaded / e.total);
      });
      rd.addEventListener("load", () => {
        this.reader = undefined;
        typeof rd.result === "string" ? ok(rd.result) : fail(new Error("The browser did not return an image data URL."));
      });
      rd.addEventListener("abort", () => fail(new Error("Image processing was cancelled.")));
      rd.addEventListener("error", () => {
        this.reader = undefined;
        fail(rd.error ?? new Error("The selected file could not be read."));
      });
      rd.readAsDataURL(file);
    });
  }

  private cancel(): void {
    this.runId++;
    this.clear();
    this.pending = undefined;
    this.eta.stop(false);
    this.eta.hide();
    UI.note("Image processing cancelled.");
  }

  private clear(): void {
    this.reader?.abort();
    this.reader = undefined;
    this.eta.stop(false);
  }
}

new VecApp().run();
