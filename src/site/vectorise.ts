import type { ImageVectoriserHostMessage } from "../webview/types";
import { Drop, Files, Host, UI } from "./browserHost";

class VecApp {
  private readonly input = UI.el<HTMLInputElement>("imageInput");
  private readonly choose = UI.el<HTMLButtonElement>("chooseImage");
  private readonly next = UI.el<HTMLAnchorElement>("continueLink");
  private ready = false;
  private pending?: ImageVectoriserHostMessage;
  private blobUrl?: string;
  private pickerOpen = false;
  private readonly host = new Host(msg => this.onMsg(msg));

  init(): void {
    this.host.init();

    this.choose.addEventListener("click", () => {
      this.pickerOpen = true;
      UI.note("Choose an image from this device.");
      this.input.value = "";
      this.input.click();
    });

    const receive = (): void => {
      this.pickerOpen = false;
      const file = this.input.files?.[0];
      if (file === undefined) {
        UI.note("No image was chosen.");
        return;
      }
      void this.load(file);
    };

    this.input.addEventListener("input", receive);
    this.input.addEventListener("change", receive);
    this.input.addEventListener("cancel", () => {
      this.pickerOpen = false;
      UI.note("The sand is waiting.");
    });

    window.addEventListener("focus", () => {
      if (!this.pickerOpen) return;
      window.setTimeout(() => {
        if (this.pickerOpen && this.input.files?.[0] === undefined) {
          this.pickerOpen = false;
          UI.note("No image reached the studio. Try choosing it from Files instead of Photos.", true);
        }
      }, 600);
    });

    new Drop(this.input, file => void this.load(file)).init();

    void import("../webview/imageVectoriser").catch(err => {
      UI.note(`Could not start the vectoriser: ${UI.err(err)}`, true);
    });
  }

  private async onMsg(msg: unknown): Promise<void> {
    if (UI.is(msg, "ready")) {
      this.ready = true;
      this.flush();
      if (this.pending === undefined && !this.pickerOpen) UI.note("The sand is waiting.");
      return;
    }

    if (
      UI.is(msg, "saveSvg") &&
      typeof msg.svg === "string" &&
      typeof msg.suggestedName === "string"
    ) {
      const name = Files.name(msg.suggestedName, "vectorised.svg");
      Files.text(msg.svg, name, "image/svg+xml;charset=utf-8");
      sessionStorage.setItem("sandsara.pendingSvg", msg.svg);
      sessionStorage.setItem("sandsara.pendingSvgFilename", name);
      this.next.hidden = false;
      UI.note("The path is ready.");
      return;
    }

    if (UI.is(msg, "showError") && typeof msg.message === "string") {
      UI.note(msg.message, true);
    }
  }

  private async load(file: File): Promise<void> {
    try {
      if (!file.type.startsWith("image/") && !/\.(png|jpe?g|bmp|webp|gif|heic|heif)$/i.test(file.name)) {
        throw new Error("Choose an image file.");
      }

      this.next.hidden = true;
      const size = this.size(file.size);
      UI.note(`Image received · ${size} · opening…`);

      if (this.blobUrl !== undefined) URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = URL.createObjectURL(file);

      this.pending = {
        type: "initialiseImage",
        dataUri: this.blobUrl,
        filename: file.name
      };

      this.flush();
      UI.note(`Image received · ${size} · finding the path…`);
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
