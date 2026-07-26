import type { ImageVectoriserHostMessage } from "../webview/types";
import { Drop, Files, Host, UI } from "./browserHost";

class VecApp {
  private readonly input = UI.el<HTMLInputElement>("imageInput");
  private readonly passToTrack = UI.el<HTMLButtonElement>("passToTrack");
  private readonly next = UI.el<HTMLAnchorElement>("continueLink");
  private ready = false;
  private pending?: ImageVectoriserHostMessage;
  private blobUrl?: string;
  private selectedFile?: File;
  private internalSave?: HTMLButtonElement;
  private passRequested = false;
  private readonly host = new Host(msg => this.onMsg(msg));

  init(): void {
    this.host.init();

    const receive = (): void => {
      const file = this.input.files?.[0];
      if (file === undefined) {
        UI.note("No image was chosen.");
        return;
      }

      if (file === this.selectedFile) {
        return;
      }

      this.selectedFile = file;
      this.load(file);
    };

    this.input.addEventListener("input", receive);
    this.input.addEventListener("change", receive);
    this.input.addEventListener("cancel", receive);

    this.passToTrack.addEventListener("click", () => {
      if (this.internalSave === undefined || this.internalSave.disabled) {
        return;
      }

      this.passRequested = true;
      UI.note("Passing the vector path to the .bin generator…");
      this.internalSave.click();
    });

    new Drop(this.input, file => {
      this.selectedFile = file;
      this.load(file);
    }).init();

    void import("../webview/imageVectoriser")
      .then(() => this.bindPassButton())
      .catch(err => {
        UI.note(`Could not start the vectoriser: ${UI.err(err)}`, true);
      });
  }

  private async onMsg(msg: unknown): Promise<void> {
    if (UI.is(msg, "ready")) {
      this.ready = true;
      this.flush();
      if (this.pending === undefined) UI.note("Choose an image to begin.");
      return;
    }

    if (
      UI.is(msg, "saveSvg") &&
      typeof msg.svg === "string" &&
      typeof msg.suggestedName === "string"
    ) {
      const name = Files.name(msg.suggestedName, "vectorised.svg");
      sessionStorage.setItem("sandsara.pendingSvg", msg.svg);
      sessionStorage.setItem("sandsara.pendingSvgFilename", name);

      if (this.passRequested) {
        this.passRequested = false;
        window.location.assign("./generate.html");
        return;
      }

      Files.text(msg.svg, name, "image/svg+xml;charset=utf-8");
      this.next.hidden = false;
      UI.note("The path is ready.");
      return;
    }

    if (UI.is(msg, "showError") && typeof msg.message === "string") {
      this.passRequested = false;
      UI.note(msg.message, true);
    }
  }

  private bindPassButton(): void {
    const save = document.getElementById("save");
    if (!(save instanceof HTMLButtonElement)) {
      throw new Error("The vectoriser save control is missing.");
    }

    this.internalSave = save;
    const update = (): void => {
      this.passToTrack.disabled = save.disabled;
      this.passToTrack.hidden = save.disabled;
    };

    update();
    new MutationObserver(update).observe(save, {
      attributes: true,
      attributeFilter: ["disabled"]
    });
  }

  private load(file: File): void {
    try {
      if (!file.type.startsWith("image/") && !/\.(png|jpe?g|bmp|webp|gif|heic|heif)$/i.test(file.name)) {
        throw new Error("Choose an image file.");
      }

      this.passRequested = false;
      this.passToTrack.hidden = true;
      this.passToTrack.disabled = true;
      this.next.hidden = true;
      const size = this.size(file.size);
      UI.note(`Image received · ${size} · opening…`);

      const nextUrl = URL.createObjectURL(file);
      const oldUrl = this.blobUrl;
      this.blobUrl = nextUrl;

      this.pending = {
        type: "initialiseImage",
        dataUri: nextUrl,
        filename: file.name
      };

      this.flush();
      UI.note(`Image received · ${size} · decoding…`);

      if (oldUrl !== undefined) {
        window.setTimeout(() => URL.revokeObjectURL(oldUrl), 10_000);
      }
    } catch (err: unknown) {
      UI.note(`Could not open the image: ${UI.err(err)}`, true);
    }
  }

  private flush(): void {
    if (!this.ready || this.pending === undefined) return;
    const msg = this.pending;
    this.pending = undefined;
    this.host.send(msg);
  }

  private size(bytes: number): string {
    if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1_000))} kB`;
    return `${(bytes / 1_000_000).toFixed(1)} MB`;
  }
}

new VecApp().init();
