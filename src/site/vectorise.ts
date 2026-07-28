import type { ImageVectoriserHostMessage } from "../webview/types";
import { Drop, Files, Host, UI } from "./browserHost";

interface SvgReadyMessage {
  readonly type: "sandsara-svg-ready";
  readonly svg: string;
  readonly filename: string;
}

class VecApp {
  private readonly input = UI.el<HTMLInputElement>("imageInput");
  private readonly next = UI.el<HTMLAnchorElement>("continueLink");
  private ready = false;
  private pending?: ImageVectoriserHostMessage;
  private blobUrl?: string;
  private selectedFile?: File;
  private internalSave?: HTMLButtonElement;
  private passToTrack?: HTMLButtonElement;
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

    new Drop(this.input, file => {
      this.selectedFile = file;
      this.load(file);
    }).init();

    void import("../webview/imageVectoriser")
      .then(() => this.bindPassButton())
      .catch(err => {
        UI.note(`Could not start the image tool: ${UI.err(err)}`, true);
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
        if (window.parent !== window) {
          const ready: SvgReadyMessage = {
            type: "sandsara-svg-ready",
            svg: msg.svg,
            filename: name
          };
          window.parent.postMessage(ready, "*");
        } else {
          window.location.assign("./generator#svg2bin");
        }
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

    const controls = save.closest<HTMLElement>(".controls");
    if (controls === null) {
      throw new Error("The vectoriser controls are missing.");
    }

    const pass = document.createElement("button");
    pass.id = "passToTrack";
    pass.type = "button";
    pass.textContent = "Continue to .bin";
    pass.disabled = save.disabled;
    save.insertAdjacentElement("afterend", pass);

    pass.addEventListener("click", () => {
      if (this.internalSave === undefined || this.internalSave.disabled) {
        return;
      }
      this.passRequested = true;
      UI.note("Passing the SVG to the track builder…");
      this.internalSave.click();
    });

    this.internalSave = save;
    this.passToTrack = pass;

    const update = (): void => {
      pass.disabled = save.disabled;
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
      if (this.passToTrack !== undefined) {
        this.passToTrack.disabled = true;
      }
      this.next.hidden = true;
      UI.note("Opening your image…");

      const nextUrl = URL.createObjectURL(file);
      const oldUrl = this.blobUrl;
      this.blobUrl = nextUrl;

      this.pending = {
        type: "initialiseImage",
        dataUri: nextUrl,
        filename: file.name
      };

      this.flush();
      UI.note("Finding the path…");

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
}

new VecApp().init();
