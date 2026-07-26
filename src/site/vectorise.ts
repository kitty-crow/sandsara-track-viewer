import type { ImageVectoriserHostMessage } from "../webview/types";
import {
  Files,
  Host,
  UI,
  Drop
} from "./browserHost";

class VecApp {
  private readonly input = UI.el<HTMLInputElement>("imageInput");
  private readonly next = UI.el<HTMLAnchorElement>("continueLink");
  private ready = false;
  private pending?: ImageVectoriserHostMessage;
  private blobUrl?: string;
  private readonly host = new Host(msg => this.onMsg(msg));

  init(): void {
    this.host.init();
    this.input.addEventListener("change", () => {
      const file = this.input.files?.[0];
      if (file !== undefined) void this.load(file);
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
      if (this.pending === undefined) UI.note("Choose an image to begin.");
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
      if (!file.type.startsWith("image/") && !/\.(png|jpe?g|bmp|webp|gif)$/i.test(file.name)) {
        throw new Error("Choose a PNG, JPEG, BMP, WebP or GIF image.");
      }

      this.next.hidden = true;
      UI.note("Opening the image…");

      if (this.blobUrl !== undefined) URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = URL.createObjectURL(file);

      this.pending = {
        type: "initialiseImage",
        dataUri: this.blobUrl,
        filename: file.name
      };

      this.flush();
      UI.note("Finding the path…");
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
}

new VecApp().init();
