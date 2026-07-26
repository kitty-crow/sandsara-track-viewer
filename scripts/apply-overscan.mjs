import { readFile, writeFile } from "node:fs/promises";

const path = new URL("../src/webview/svgToTrack.ts", import.meta.url);
let text = await readFile(path, "utf8");

text = text.replace(
  /<label for="padding">Circular padding<\/label>\s*<div class="control-row">\s*<input id="padding" type="range" min="-100" max="20" step="0\.5" value="4">\s*<span id="paddingValue" class="value">4\.0%<\/span>\s*<\/div>\s*<span class="hint">Negative values enlarge the artwork and trim anything outside the circular drawing area\.<\/span>/m,
  `<label for="padding">Overscan</label>\n      <div class="control-row">\n        <input id="padding" type="range" min="-1" max="1" step="0.01" value="-0.04">\n        <span id="paddingValue" class="value">-0.04</span>\n      </div>\n      <span class="hint">Positive values enlarge and crop the artwork. Negative values shrink it inside the circle.</span>`
);

text = text.replaceAll(
  "clamp(numberValue(padding, 4), -100, 20)",
  "clamp(numberValue(padding, -0.04), -1, 1)"
);
text = text.replaceAll("paddingPercent: number", "overscan: number");
text = text.replaceAll(
  "const usableRadius = SANDSARA_RADIUS * (1 - paddingPercent / 100);",
  "const usableRadius = SANDSARA_RADIUS * (1 + overscan);"
);
text = text.replaceAll(
  "return paddingPercent < 0\n    ? clipPathsToCircle(fittedPaths, SANDSARA_RADIUS)\n    : fittedPaths;",
  "return overscan > 0\n    ? clipPathsToCircle(fittedPaths, SANDSARA_RADIUS)\n    : fittedPaths;"
);
text = text.replace(
  /paddingValue\.textContent\s*=\s*`\$\{numberValue\(padding,\s*4\)\.toFixed\(1\)\}%`;/,
  "paddingValue.textContent = numberValue(padding, -0.04).toFixed(2);"
);

const required = [
  '<label for="padding">Overscan</label>',
  'min="-1" max="1" step="0.01" value="-0.04"',
  "clamp(numberValue(padding, -0.04), -1, 1)",
  "const usableRadius = SANDSARA_RADIUS * (1 + overscan);",
  "return overscan > 0",
  "paddingValue.textContent = numberValue(padding, -0.04).toFixed(2);"
];

for (const marker of required) {
  if (!text.includes(marker)) {
    throw new Error(`Overscan source normalisation failed: ${marker}`);
  }
}

await writeFile(path, text, "utf8");
