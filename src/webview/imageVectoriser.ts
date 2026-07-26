import type {
  ImageVectoriserHostMessage,
  ImageVectoriserWebviewMessage
} from "./types";

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Segment {
  readonly a: Point;
  readonly b: Point;
}

interface VectorisationResult {
  readonly width: number;
  readonly height: number;
  readonly paths: readonly (readonly Point[])[];
  readonly svg: string;
}

const vscode = acquireVsCodeApi();
const app = document.getElementById("app");

if (app === null) {
  throw new Error("The image vectoriser root element is missing.");
}

app.innerHTML = `
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 16px;
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editor-background);
    font-family: var(--vscode-font-family);
  }
  h1 { margin: 0 0 4px; font-size: 1.35rem; }
  .subtitle { margin: 0 0 16px; color: var(--vscode-descriptionForeground); }
  .layout {
    display: grid;
    grid-template-columns: minmax(240px, 330px) minmax(0, 1fr);
    gap: 18px;
    align-items: start;
  }
  .controls {
    display: grid;
    gap: 12px;
    padding: 14px;
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background);
  }
  .control { display: grid; gap: 5px; }
  .control-row { display: flex; align-items: center; gap: 8px; }
  label { font-weight: 600; }
  input[type="range"] { width: 100%; }
  input[type="number"], select {
    width: 100%;
    padding: 5px 7px;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border);
  }
  button {
    padding: 8px 12px;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    border: 0;
    cursor: pointer;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: 0.55; cursor: default; }
  .value { min-width: 48px; text-align: right; color: var(--vscode-descriptionForeground); }
  .preview-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .preview-card {
    min-width: 0;
    padding: 10px;
    border: 1px solid var(--vscode-panel-border);
  }
  .preview-card h2 { margin: 0 0 8px; font-size: 1rem; }
  canvas {
    display: block;
    width: 100%;
    max-height: 70vh;
    object-fit: contain;
    background: white;
    border: 1px solid var(--vscode-panel-border);
  }
  .stats {
    margin-top: 12px;
    padding: 10px;
    color: var(--vscode-descriptionForeground);
    border: 1px solid var(--vscode-panel-border);
  }
  .hint { font-size: 0.9rem; color: var(--vscode-descriptionForeground); }
  @media (max-width: 850px) {
    .layout { grid-template-columns: 1fr; }
  }
  @media (max-width: 600px) {
    .preview-grid { grid-template-columns: 1fr; }
  }
</style>
<h1>Image to line-art SVG</h1>
<p id="subtitle" class="subtitle">Loading image…</p>
<div class="layout">
  <section class="controls" aria-label="Vectorisation controls">
    <div class="control">
      <label for="algorithm">Method</label>
      <select id="algorithm">
        <option value="sobel">Sobel edge lines</option>
        <option value="silhouette">Black-and-white contours</option>
      </select>
    </div>
    <div class="control">
      <label for="contrast">Contrast</label>
      <div class="control-row">
        <input id="contrast" type="range" min="0.5" max="4" step="0.1" value="1.8">
        <span id="contrastValue" class="value">1.8×</span>
      </div>
    </div>
    <div class="control">
      <label for="threshold">Threshold</label>
      <div class="control-row">
        <input id="threshold" type="range" min="0" max="255" step="1" value="92">
        <span id="thresholdValue" class="value">92</span>
      </div>
      <label class="control-row"><input id="autoThreshold" type="checkbox" checked> Use Otsu automatic threshold for contours</label>
    </div>
    <div class="control">
      <label for="blur">Noise reduction</label>
      <div class="control-row">
        <input id="blur" type="range" min="0" max="3" step="1" value="1">
        <span id="blurValue" class="value">1 px</span>
      </div>
    </div>
    <div class="control">
      <label for="simplify">Line simplification</label>
      <div class="control-row">
        <input id="simplify" type="range" min="0" max="6" step="0.25" value="1.25">
        <span id="simplifyValue" class="value">1.25</span>
      </div>
    </div>
    <div class="control">
      <label for="minimumLength">Minimum line length</label>
      <div class="control-row">
        <input id="minimumLength" type="range" min="0" max="150" step="1" value="12">
        <span id="minimumLengthValue" class="value">12 px</span>
      </div>
    </div>
    <div class="control">
      <label for="maximumDimension">Processing resolution</label>
      <input id="maximumDimension" type="number" min="128" max="2048" step="64" value="1024">
      <span class="hint">Higher values preserve detail but create larger SVG files.</span>
    </div>
    <label class="control-row"><input id="invert" type="checkbox"> Invert black and white</label>
    <button id="save" disabled>Save vectorised SVG…</button>
  </section>
  <section>
    <div class="preview-grid">
      <div class="preview-card">
        <h2>Source</h2>
        <canvas id="sourcePreview"></canvas>
      </div>
      <div class="preview-card">
        <h2>Vector lines</h2>
        <canvas id="vectorPreview"></canvas>
      </div>
    </div>
    <div id="stats" class="stats">Waiting for image…</div>
  </section>
</div>`;

const subtitle = requiredElement<HTMLElement>("subtitle");
const algorithm = requiredElement<HTMLSelectElement>("algorithm");
const contrast = requiredElement<HTMLInputElement>("contrast");
const threshold = requiredElement<HTMLInputElement>("threshold");
const autoThreshold = requiredElement<HTMLInputElement>("autoThreshold");
const blur = requiredElement<HTMLInputElement>("blur");
const simplify = requiredElement<HTMLInputElement>("simplify");
const minimumLength = requiredElement<HTMLInputElement>("minimumLength");
const maximumDimension = requiredElement<HTMLInputElement>("maximumDimension");
const invert = requiredElement<HTMLInputElement>("invert");
const saveButton = requiredElement<HTMLButtonElement>("save");
const sourcePreview = requiredElement<HTMLCanvasElement>("sourcePreview");
const vectorPreview = requiredElement<HTMLCanvasElement>("vectorPreview");
const stats = requiredElement<HTMLElement>("stats");

let loadedImage: HTMLImageElement | undefined;
let sourceFilename = "image.png";
let latestResult: VectorisationResult | undefined;
let processTimer: number | undefined;

for (const input of [
  algorithm,
  contrast,
  threshold,
  autoThreshold,
  blur,
  simplify,
  minimumLength,
  maximumDimension,
  invert
]) {
  input.addEventListener("input", scheduleProcessing);
  input.addEventListener("change", scheduleProcessing);
}

saveButton.addEventListener("click", () => {
  if (latestResult === undefined) {
    return;
  }

  const message: ImageVectoriserWebviewMessage = {
    type: "saveSvg",
    svg: latestResult.svg,
    suggestedName: `${filenameStem(sourceFilename)}-vectorised.svg`
  };
  vscode.postMessage(message);
});

window.addEventListener("message", (event: MessageEvent<ImageVectoriserHostMessage>) => {
  if (event.data.type !== "initialiseImage") {
    return;
  }

  sourceFilename = event.data.filename;
  subtitle.textContent = sourceFilename;
  void loadImage(event.data.dataUri);
});

const readyMessage: ImageVectoriserWebviewMessage = { type: "ready" };
vscode.postMessage(readyMessage);

async function loadImage(dataUri: string): Promise<void> {
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = dataUri;
    await image.decode();
    loadedImage = image;
    processImage();
  } catch (error: unknown) {
    reportError(`The image could not be decoded: ${toErrorMessage(error)}`);
  }
}

function scheduleProcessing(): void {
  updateDisplayedValues();
  if (processTimer !== undefined) {
    window.clearTimeout(processTimer);
  }
  processTimer = window.setTimeout(processImage, 120);
}

function processImage(): void {
  processTimer = undefined;
  updateDisplayedValues();

  if (loadedImage === undefined) {
    return;
  }

  try {
    stats.textContent = "Processing…";
    const maxDimension = clampInteger(numberValue(maximumDimension, 1024), 128, 2048);
    maximumDimension.value = String(maxDimension);
    const scale = Math.min(
      1,
      maxDimension / Math.max(loadedImage.naturalWidth, loadedImage.naturalHeight)
    );
    const width = Math.max(2, Math.round(loadedImage.naturalWidth * scale));
    const height = Math.max(2, Math.round(loadedImage.naturalHeight * scale));
    const workCanvas = document.createElement("canvas");
    workCanvas.width = width;
    workCanvas.height = height;
    const context = workCanvas.getContext("2d", { willReadFrequently: true });

    if (context === null) {
      throw new Error("Canvas processing is not available.");
    }

    context.fillStyle = "white";
    context.fillRect(0, 0, width, height);
    context.drawImage(loadedImage, 0, 0, width, height);
    drawSourcePreview(workCanvas);

    const imageData = context.getImageData(0, 0, width, height);
    let grayscale = toGrayscale(imageData.data, numberValue(contrast, 1.8));
    const blurRadius = clampInteger(numberValue(blur, 1), 0, 3);

    if (blurRadius > 0) {
      grayscale = boxBlur(grayscale, width, height, blurRadius);
    }

    const thresholdValue = clampInteger(numberValue(threshold, 92), 0, 255);
    const mask = algorithm.value === "silhouette"
      ? silhouetteMask(
          grayscale,
          autoThreshold.checked ? otsuThreshold(grayscale) : thresholdValue,
          invert.checked
        )
      : sobelMask(grayscale, width, height, thresholdValue);

    const padded = padMask(mask, width, height);
    const rawPaths = joinSegments(
      marchingSquares(padded.mask, padded.width, padded.height)
    ).map(pathPoints => pathPoints.map(point => ({
      x: point.x - 1,
      y: point.y - 1
    })));

    const minimum = Math.max(0, numberValue(minimumLength, 12));
    const tolerance = Math.max(0, numberValue(simplify, 1.25));
    const paths = rawPaths
      .filter(pathPoints => polylineLength(pathPoints) >= minimum)
      .map(pathPoints => simplifyPolyline(pathPoints, tolerance))
      .filter(pathPoints => pathPoints.length >= 2);

    const svg = createSvg(width, height, paths, sourceFilename);
    latestResult = { width, height, paths, svg };
    saveButton.disabled = paths.length === 0;
    drawVectorPreview(width, height, paths);

    const pointCount = paths.reduce((sum, pathPoints) => sum + pathPoints.length, 0);
    stats.textContent =
      `${width.toLocaleString("en-GB")} × ${height.toLocaleString("en-GB")} pixels · ` +
      `${paths.length.toLocaleString("en-GB")} vector lines · ` +
      `${pointCount.toLocaleString("en-GB")} vector points`;
  } catch (error: unknown) {
    latestResult = undefined;
    saveButton.disabled = true;
    reportError(`Vectorisation failed: ${toErrorMessage(error)}`);
  }
}

function toGrayscale(rgba: Uint8ClampedArray, contrastFactor: number): Float32Array {
  const grayscale = new Float32Array(rgba.length / 4);
  const factor = Math.max(0.1, contrastFactor);

  for (let pixel = 0, output = 0; pixel < rgba.length; pixel += 4, output++) {
    const red = rgba[pixel] ?? 0;
    const green = rgba[pixel + 1] ?? 0;
    const blue = rgba[pixel + 2] ?? 0;
    const alpha = (rgba[pixel + 3] ?? 255) / 255;
    const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) * alpha +
      255 * (1 - alpha);
    grayscale[output] = clamp((luminance - 128) * factor + 128, 0, 255);
  }

  return grayscale;
}

function boxBlur(
  source: Float32Array,
  width: number,
  height: number,
  radius: number
): Float32Array {
  const horizontal = new Float32Array(source.length);
  const output = new Float32Array(source.length);
  const diameter = radius * 2 + 1;

  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset++) {
      sum += source[y * width + clampInteger(offset, 0, width - 1)] ?? 0;
    }
    for (let x = 0; x < width; x++) {
      horizontal[y * width + x] = sum / diameter;
      const removeX = clampInteger(x - radius, 0, width - 1);
      const addX = clampInteger(x + radius + 1, 0, width - 1);
      sum += (source[y * width + addX] ?? 0) - (source[y * width + removeX] ?? 0);
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset++) {
      sum += horizontal[clampInteger(offset, 0, height - 1) * width + x] ?? 0;
    }
    for (let y = 0; y < height; y++) {
      output[y * width + x] = sum / diameter;
      const removeY = clampInteger(y - radius, 0, height - 1);
      const addY = clampInteger(y + radius + 1, 0, height - 1);
      sum += (horizontal[addY * width + x] ?? 0) -
        (horizontal[removeY * width + x] ?? 0);
    }
  }

  return output;
}

function sobelMask(
  grayscale: Float32Array,
  width: number,
  height: number,
  thresholdValue: number
): Uint8Array {
  const magnitudes = new Float32Array(grayscale.length);
  const directions = new Uint8Array(grayscale.length);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const topLeft = grayscale[(y - 1) * width + x - 1] ?? 0;
      const top = grayscale[(y - 1) * width + x] ?? 0;
      const topRight = grayscale[(y - 1) * width + x + 1] ?? 0;
      const left = grayscale[y * width + x - 1] ?? 0;
      const right = grayscale[y * width + x + 1] ?? 0;
      const bottomLeft = grayscale[(y + 1) * width + x - 1] ?? 0;
      const bottom = grayscale[(y + 1) * width + x] ?? 0;
      const bottomRight = grayscale[(y + 1) * width + x + 1] ?? 0;

      const gradientX = -topLeft + topRight - 2 * left + 2 * right - bottomLeft + bottomRight;
      const gradientY = -topLeft - 2 * top - topRight + bottomLeft + 2 * bottom + bottomRight;
      const index = y * width + x;
      magnitudes[index] = Math.hypot(gradientX, gradientY);

      let angle = Math.atan2(gradientY, gradientX) * 180 / Math.PI;
      if (angle < 0) {
        angle += 180;
      }
      directions[index] = angle < 22.5 || angle >= 157.5
        ? 0
        : angle < 67.5
          ? 1
          : angle < 112.5
            ? 2
            : 3;
    }
  }

  const output = new Uint8Array(grayscale.length);
  const scaledThreshold = thresholdValue * 4;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = y * width + x;
      const magnitude = magnitudes[index] ?? 0;
      if (magnitude < scaledThreshold) {
        continue;
      }

      const direction = directions[index] ?? 0;
      let first = 0;
      let second = 0;

      if (direction === 0) {
        first = magnitudes[index - 1] ?? 0;
        second = magnitudes[index + 1] ?? 0;
      } else if (direction === 1) {
        first = magnitudes[index - width + 1] ?? 0;
        second = magnitudes[index + width - 1] ?? 0;
      } else if (direction === 2) {
        first = magnitudes[index - width] ?? 0;
        second = magnitudes[index + width] ?? 0;
      } else {
        first = magnitudes[index - width - 1] ?? 0;
        second = magnitudes[index + width + 1] ?? 0;
      }

      if (magnitude >= first && magnitude >= second) {
        output[index] = 1;
      }
    }
  }

  return output;
}

function silhouetteMask(
  grayscale: Float32Array,
  thresholdValue: number,
  invertValue: boolean
): Uint8Array {
  const output = new Uint8Array(grayscale.length);

  for (let index = 0; index < grayscale.length; index++) {
    const value = grayscale[index] ?? 255;
    const dark = value <= thresholdValue;
    output[index] = dark !== invertValue ? 1 : 0;
  }

  return output;
}

function otsuThreshold(values: Float32Array): number {
  const histogram = new Uint32Array(256);
  for (const value of values) {
    const bucket = clampInteger(Math.round(value), 0, 255);
    histogram[bucket] = (histogram[bucket] ?? 0) + 1;
  }

  let totalWeighted = 0;
  for (let index = 0; index < histogram.length; index++) {
    totalWeighted += index * (histogram[index] ?? 0);
  }

  let backgroundWeight = 0;
  let backgroundWeighted = 0;
  let bestVariance = -1;
  let bestThreshold = 127;

  for (let thresholdIndex = 0; thresholdIndex < 256; thresholdIndex++) {
    const count = histogram[thresholdIndex] ?? 0;
    backgroundWeight += count;
    if (backgroundWeight === 0) {
      continue;
    }

    const foregroundWeight = values.length - backgroundWeight;
    if (foregroundWeight === 0) {
      break;
    }

    backgroundWeighted += thresholdIndex * count;
    const backgroundMean = backgroundWeighted / backgroundWeight;
    const foregroundMean = (totalWeighted - backgroundWeighted) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight *
      (backgroundMean - foregroundMean) ** 2;

    if (variance > bestVariance) {
      bestVariance = variance;
      bestThreshold = thresholdIndex;
    }
  }

  return bestThreshold;
}

function padMask(
  source: Uint8Array,
  width: number,
  height: number
): { readonly mask: Uint8Array; readonly width: number; readonly height: number } {
  const paddedWidth = width + 2;
  const paddedHeight = height + 2;
  const mask = new Uint8Array(paddedWidth * paddedHeight);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      mask[(y + 1) * paddedWidth + x + 1] = source[y * width + x] ?? 0;
    }
  }

  return { mask, width: paddedWidth, height: paddedHeight };
}

function marchingSquares(mask: Uint8Array, width: number, height: number): Segment[] {
  const segments: Segment[] = [];

  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const topLeftInside = (mask[y * width + x] ?? 0) !== 0;
      const topRightInside = (mask[y * width + x + 1] ?? 0) !== 0;
      const bottomRightInside = (mask[(y + 1) * width + x + 1] ?? 0) !== 0;
      const bottomLeftInside = (mask[(y + 1) * width + x] ?? 0) !== 0;
      const state =
        (topLeftInside ? 8 : 0) |
        (topRightInside ? 4 : 0) |
        (bottomRightInside ? 2 : 0) |
        (bottomLeftInside ? 1 : 0);

      const top = { x: x + 0.5, y };
      const right = { x: x + 1, y: y + 0.5 };
      const bottom = { x: x + 0.5, y: y + 1 };
      const left = { x, y: y + 0.5 };

      switch (state) {
        case 0:
        case 15:
          break;
        case 1:
        case 14:
          segments.push({ a: left, b: bottom });
          break;
        case 2:
        case 13:
          segments.push({ a: bottom, b: right });
          break;
        case 3:
        case 12:
          segments.push({ a: left, b: right });
          break;
        case 4:
        case 11:
          segments.push({ a: top, b: right });
          break;
        case 5:
          segments.push({ a: top, b: left }, { a: bottom, b: right });
          break;
        case 6:
        case 9:
          segments.push({ a: top, b: bottom });
          break;
        case 7:
        case 8:
          segments.push({ a: top, b: left });
          break;
        case 10:
          segments.push({ a: top, b: right }, { a: left, b: bottom });
          break;
        default:
          break;
      }
    }
  }

  return segments;
}

function joinSegments(segments: readonly Segment[]): Point[][] {
  const adjacency = new Map<string, number[]>();
  const pointsByKey = new Map<string, Point>();
  const used = new Uint8Array(segments.length);

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (segment === undefined) {
      continue;
    }
    addAdjacency(segment.a, index);
    addAdjacency(segment.b, index);
  }

  const paths: Point[][] = [];

  for (const [key, edgeIndexes] of adjacency) {
    if (edgeIndexes.length === 2) {
      continue;
    }
    for (const edgeIndex of edgeIndexes) {
      if ((used[edgeIndex] ?? 0) === 0) {
        paths.push(trace(edgeIndex, key));
      }
    }
  }

  for (let edgeIndex = 0; edgeIndex < segments.length; edgeIndex++) {
    if ((used[edgeIndex] ?? 0) !== 0) {
      continue;
    }
    const segment = segments[edgeIndex];
    if (segment !== undefined) {
      paths.push(trace(edgeIndex, pointKey(segment.a)));
    }
  }

  return paths.filter(pathPoints => pathPoints.length >= 2);

  function addAdjacency(point: Point, edgeIndex: number): void {
    const key = pointKey(point);
    pointsByKey.set(key, point);
    const list = adjacency.get(key);
    if (list === undefined) {
      adjacency.set(key, [edgeIndex]);
    } else {
      list.push(edgeIndex);
    }
  }

  function trace(startEdge: number, startKey: string): Point[] {
    const output: Point[] = [];
    let currentEdge: number | undefined = startEdge;
    let currentKey = startKey;
    const startPoint = pointsByKey.get(startKey);
    if (startPoint !== undefined) {
      output.push(startPoint);
    }

    while (currentEdge !== undefined && (used[currentEdge] ?? 0) === 0) {
      used[currentEdge] = 1;
      const segment = segments[currentEdge];
      if (segment === undefined) {
        break;
      }

      const aKey = pointKey(segment.a);
      const nextPoint = aKey === currentKey ? segment.b : segment.a;
      currentKey = pointKey(nextPoint);
      output.push(nextPoint);

      const options = adjacency.get(currentKey) ?? [];
      currentEdge = options.find(index => (used[index] ?? 0) === 0);
    }

    return output;
  }
}

function simplifyPolyline(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2 || tolerance <= 0) {
    return [...points];
  }

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<readonly [number, number]> = [[0, points.length - 1]];
  const squaredTolerance = tolerance * tolerance;

  while (stack.length > 0) {
    const range = stack.pop();
    if (range === undefined) {
      continue;
    }
    const [startIndex, endIndex] = range;
    const start = points[startIndex];
    const end = points[endIndex];
    if (start === undefined || end === undefined) {
      continue;
    }

    let maximumDistance = 0;
    let maximumIndex = -1;

    for (let index = startIndex + 1; index < endIndex; index++) {
      const point = points[index];
      if (point === undefined) {
        continue;
      }
      const distance = squaredDistanceToSegment(point, start, end);
      if (distance > maximumDistance) {
        maximumDistance = distance;
        maximumIndex = index;
      }
    }

    if (maximumIndex >= 0 && maximumDistance > squaredTolerance) {
      keep[maximumIndex] = 1;
      stack.push([startIndex, maximumIndex], [maximumIndex, endIndex]);
    }
  }

  return points.filter((_point, index) => (keep[index] ?? 0) !== 0);
}

function squaredDistanceToSegment(point: Point, start: Point, end: Point): number {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  if (deltaX === 0 && deltaY === 0) {
    return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
  }

  const projection = clamp(
    ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) /
      (deltaX * deltaX + deltaY * deltaY),
    0,
    1
  );
  const projectedX = start.x + projection * deltaX;
  const projectedY = start.y + projection * deltaY;
  return (point.x - projectedX) ** 2 + (point.y - projectedY) ** 2;
}

function polylineLength(points: readonly Point[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous !== undefined && current !== undefined) {
      length += Math.hypot(current.x - previous.x, current.y - previous.y);
    }
  }
  return length;
}

function createSvg(
  width: number,
  height: number,
  paths: readonly (readonly Point[])[],
  filename: string
): string {
  const pathMarkup = paths.map(pathPoints => {
    const commands = pathPoints.map((point, index) =>
      `${index === 0 ? "M" : "L"}${formatCoordinate(point.x)} ${formatCoordinate(point.y)}`
    ).join(" ");
    return `  <path d="${commands}"/>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" fill="none" stroke="#000" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
  <title>Vectorised ${escapeXml(filename)}</title>
${pathMarkup}
</svg>
`;
}

function drawSourcePreview(source: HTMLCanvasElement): void {
  sourcePreview.width = source.width;
  sourcePreview.height = source.height;
  const context = sourcePreview.getContext("2d");
  if (context !== null) {
    context.clearRect(0, 0, source.width, source.height);
    context.drawImage(source, 0, 0);
  }
}

function drawVectorPreview(
  width: number,
  height: number,
  paths: readonly (readonly Point[])[]
): void {
  vectorPreview.width = width;
  vectorPreview.height = height;
  const context = vectorPreview.getContext("2d");
  if (context === null) {
    return;
  }

  context.fillStyle = "white";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "black";
  context.lineWidth = Math.max(1, Math.min(width, height) / 900);
  context.lineCap = "round";
  context.lineJoin = "round";

  for (const pathPoints of paths) {
    const first = pathPoints[0];
    if (first === undefined) {
      continue;
    }
    context.beginPath();
    context.moveTo(first.x, first.y);
    for (let index = 1; index < pathPoints.length; index++) {
      const point = pathPoints[index];
      if (point !== undefined) {
        context.lineTo(point.x, point.y);
      }
    }
    context.stroke();
  }
}

function updateDisplayedValues(): void {
  requiredElement<HTMLElement>("contrastValue").textContent =
    `${numberValue(contrast, 1.8).toFixed(1)}×`;
  requiredElement<HTMLElement>("thresholdValue").textContent =
    String(clampInteger(numberValue(threshold, 92), 0, 255));
  requiredElement<HTMLElement>("blurValue").textContent =
    `${clampInteger(numberValue(blur, 1), 0, 3)} px`;
  requiredElement<HTMLElement>("simplifyValue").textContent =
    numberValue(simplify, 1.25).toFixed(2);
  requiredElement<HTMLElement>("minimumLengthValue").textContent =
    `${Math.max(0, numberValue(minimumLength, 12)).toFixed(0)} px`;
  autoThreshold.disabled = algorithm.value !== "silhouette";
}

function pointKey(point: Point): string {
  return `${Math.round(point.x * 2)},${Math.round(point.y * 2)}`;
}

function formatCoordinate(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function filenameStem(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot > 0 ? filename.slice(0, lastDot) : filename;
}

function numberValue(input: HTMLInputElement, fallback: number): number {
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.round(clamp(value, minimum, maximum));
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing webview element: ${id}`);
  }
  return element as T;
}

function reportError(message: string): void {
  stats.textContent = message;
  const outgoing: ImageVectoriserWebviewMessage = {
    type: "showError",
    message
  };
  vscode.postMessage(outgoing);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
