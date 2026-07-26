import { decodeSandsaraTrack } from "../sandsara";
import type { FlatTrackPayload, TrackPreviewHostMessage } from "../webview/types";
import { Host, UI } from "./browserHost";

class ViewApp {
  private readonly input = UI.el<HTMLInputElement>("binInput");
  private readonly host = new Host(msg => this.msg(msg));
  private ready = false;
  private pending: TrackPreviewHostMessage | undefined;

  run(): void {
    this.host.init();
    this.input.addEventListener("change", () => {
      const file = this.input.files?.[0];
      if (file !== undefined) void this.load(file);
    });
    void import("../webview/trackPreview").catch(err => UI.note(`Could not start the track preview: ${UI.err(err)}`, true));
  }

  private msg(msg: unknown): void {
    if (!UI.is(msg, "ready")) return;
    this.ready = true;
    this.pending === undefined ? UI.note("Choose a Sandsara .bin file to inspect.") : this.send();
  }

  private async load(file: File): Promise<void> {
    try {
      UI.note(`Decoding ${file.name}…`);
      const track = decodeSandsaraTrack(new Uint8Array(await file.arrayBuffer()));
      this.pending = { type: "track", payload: this.payload(file.name, track) };
      this.send();
      UI.note(`Decoded ${track.points.length.toLocaleString("en-GB")} points from ${file.name}.`);
    } catch (err: unknown) {
      this.pending = undefined;
      UI.note(`Could not decode the track: ${UI.err(err)}`, true);
    }
  }

  private send(): void {
    if (!this.ready || this.pending === undefined) return;
    const msg = this.pending;
    this.pending = undefined;
    this.host.send(msg);
  }

  private payload(name: string, track: ReturnType<typeof decodeSandsaraTrack>): FlatTrackPayload {
    const stride = Math.max(1, Math.ceil(track.points.length / 100_000));
    const points: number[] = [];
    for (let i = 0; i < track.points.length; i += stride) {
      const point = track.points[i];
      if (point !== undefined) points.push(point.x, point.y);
    }
    const last = track.points.at(-1);
    if (last !== undefined && (points.at(-2) !== last.x || points.at(-1) !== last.y)) points.push(last.x, last.y);
    return {
      points,
      pointCount: track.points.length,
      byteLength: track.byteLength,
      minX: track.minX,
      maxX: track.maxX,
      minY: track.minY,
      maxY: track.maxY,
      maximumRadius: track.maximumRadius,
      warnings: track.warnings,
      filename: name
    };
  }
}

new ViewApp().run();
