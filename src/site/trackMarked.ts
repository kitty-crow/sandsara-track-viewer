import { marked, type MarkedToken } from "marked";
import { renderTrackBodyLine } from "../webview/trackText";

interface TrackMarkupGlobal {
  __SANDSARA_TRACK_MARKUP__?: (source: string) => string;
}

marked.use({
  extensions: [{
    name: "sandsaraTrackCoordinate",
    level: "block",
    start: () => 0,
    tokenizer(source: string): MarkedToken | false {
      if (source.length === 0) return false;
      const newline = source.indexOf("\n");
      const raw = newline < 0 ? source : source.slice(0, newline + 1);
      const text = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
      return { type: "sandsaraTrackCoordinate", raw, text };
    },
    renderer(token: MarkedToken): string {
      return `${renderTrackBodyLine(token.text)}\n`;
    }
  }]
});

const global = globalThis as unknown as TrackMarkupGlobal;
global.__SANDSARA_TRACK_MARKUP__ = (source: string): string => {
  const rendered = marked.parse(source, { async: false, gfm: false });
  return typeof rendered === "string" ? rendered : "";
};
