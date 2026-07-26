import { readFile, writeFile } from "node:fs/promises";

const path = new URL("../src/webview/svgToTrack.ts", import.meta.url);
let text = await readFile(path, "utf8");

const replacements = [
  [
    `<label for="padding">Circular padding</label>\n      <div class="control-row">\n        <input id="padding" type="range" min="-100" max="20" step="0.5" value="4">\n        <span id="paddingValue" class="value">4.0%</span>\n      </div>\n      <span class="hint">Negative values enlarge the artwork and trim anything outside the circular drawing area.</span>`,
    `<label for="padding">Overscan</label>\n      <div class="control-row">\n        <input id="padding" type="range" min="-1" max="1" step="0.01" value="-0.04">\n        <span id="paddingValue" class="value">-0.04</span>\n      </div>\n      <span class="hint">Positive values enlarge and crop the artwork. Negative values shrink it inside the circle.</span>`
  ],
  [`clamp(numberValue(padding, 4), -100, 20)`, `clamp(numberValue(padding, -0.04), -1, 1)`],
  [`paddingPercent: number`, `overscan: number`],
  [`const usableRadius = SANDSARA_RADIUS * (1 - paddingPercent / 100);`, `const usableRadius = SANDSARA_RADIUS * (1 + overscan);`],
  [`return paddingPercent < 0\n    ? clipPathsToCircle(fittedPaths, SANDSARA_RADIUS)\n    : fittedPaths;`, `return overscan > 0\n    ? clipPathsToCircle(fittedPaths, SANDSARA_RADIUS)\n    : fittedPaths;`],
  [`paddingValue.textContent = \`${numberValue(padding, 4).toFixed(1)}%\`;`, `paddingValue.textContent = numberValue(padding, -0.04).toFixed(2);`]
];

let changed = false;
for (const [oldText, newText] of replacements) {
  if (text.includes(newText)) continue;
  if (!text.includes(oldText)) throw new Error(`Overscan source pattern not found: ${oldText.slice(0, 80)}`);
  text = text.replaceAll(oldText, newText);
  changed = true;
}

if (changed) await writeFile(path, text, "utf8");
