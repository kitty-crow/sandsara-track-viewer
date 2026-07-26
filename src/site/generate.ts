import { encodeSandsaraTrack, pointsFromFlatArray } from "../sandsara";
import type { SvgToTrackHostMessage } from "../webview/types";
import { Drop, Files, Host, UI } from "./browserHost";

class GenApp {
  private readonly input = UI.el<HTMLInputElement>("svgInput");
  private readonly host = new Host(msg => this.msg(msg));
  private ready = false;
  private pending: SvgToTrackHostMessage | undefined = this.fromSession();

  run(): void {
    this.host.init();
    this.input.addEventListener("change", () => {
      const file = this.input.files?.[0];
      if (file !== undefined) void this.load(file);
    });
    new Drop(this.input, file => void this.load(file)).init();
    void import("../webview/svgToTrack").catch(err => UI.note(`Could not start the track generator: ${UI.err(err)}`, true));
  }

  private async msg(msg: unknown): Promise<void> {
    if (UI.is(msg, "ready")) {
      this.ready = true;
      this.pending === undefined ? UI.note("Choose an SVG to generate a Sandsara track.") : this.send();
      return;
    }

    if (UI.is(msg, "saveTrack") && Array.isArray(msg.points) &&
      msg.points.every(value => typeof value === "number") && typeof msg.suggestedName === "string") {
      try {
        const pts = pointsFromFlatArray(msg.points);
        const data = encodeSandsaraTrack(pts);
        const name = Files.name(msg.suggestedName, "Sandsara-trackNumber-custom.bin");
        Files.bytes(data, name);
        UI.note(`Downloaded ${name} with ${pts.length.toLocaleString("en-GB")} points.`);
      } catch (err: unknown) {
        UI.note(`Could not encode the track: ${UI.err(err)}`, true);
      }
      return;
    }

    if (UI.is(msg, "showError") && typeof msg.message === "string") UI.note(msg.message, true);
  }

  private async load(file: File): Promise<void> {
    try {
      if (!/\.svg$/i.test(file.name) && file.type !== "image/svg+xml") throw new Error("Choose an SVG file.");
      UI.note(`Reading ${file.name}…`);
      this.pending = { type: "initialiseSvg", svg: await file.text(), filename: file.name };
      this.send();
    } catch (err: unknown) {
      UI.note(`Could not read the SVG: ${UI.err(err)}`, true);
    }
  }

  private send(): void {
    if (!this.ready || this.pending === undefined) return;
    const msg = this.pending;
    this.pending = undefined;
    this.host.send(msg);
    UI.note(`Generating and previewing ${msg.filename} entirely in this browser.`);
  }

  private fromSession(): SvgToTrackHostMessage | undefined {
    const svg = sessionStorage.getItem("sandsara.pendingSvg");
    if (svg === null) return undefined;
    const filename = sessionStorage.getItem("sandsara.pendingSvgFilename") ?? "vectorised.svg";
    sessionStorage.removeItem("sandsara.pendingSvg");
    sessionStorage.removeItem("sandsara.pendingSvgFilename");
    return { type: "initialiseSvg", svg, filename };
  }
}

new GenApp().run();
