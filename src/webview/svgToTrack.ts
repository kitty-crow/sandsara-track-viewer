import type {
  SvgToTrackHostMessage,
  SvgToTrackWebviewMessage
} from "./types";

interface Point {
  readonly x: number;
  readonly y: number;
}

interface GeneratedTrack {
  readonly points: readonly Point[];
  readonly sourcePathCount: number;
  readonly connectorCount: number;
  readonly sourcePointCount: number;
}

const SANDSARA_RADIUS = 32_767;
const vscode = acquireVsCodeApi();
const app = document.getElementById("app");

if (app === null) {
  throw new Error("The SVG converter root element is missing.");
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
    grid-template-columns: minmax(250px, 340px) minmax(0, 1fr);
    gap: 18px;
    align-items: start;
  }
  .controls {
    display: grid;
    gap: 13px;
    padding: 14px;
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background);
  }
  .control { display: grid; gap: 5px; }
  .control-row { display: flex; align-items: center; gap: 8px; }
  label { font-weight: 600; }
  input[type="range"] { width: 100%; }
  input[type="number"] {
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
  .value { min-width: 62px; text-align: right; color: var(--vscode-descriptionForeground); }
  canvas {
    display: block;
    width: min(100%, 850px);
    aspect-ratio: 1;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
  }
  .stats, .notice {
    margin-top: 12px;
    padding: 10px;
    border: 1px solid var(--vscode-panel-border);
  }
  .stats { color: var(--vscode-descriptionForeground); }
  .notice { color: var(--vscode-editorWarning-foreground); }
  .hint { font-size: 0.9rem; color: var(--vscode-descriptionForeground); }
  #svgMount {
    position: fixed;
    left: -100000px;
    top: -100000px;
    width: 1000px;
    height: 1000px;
    opacity: 0;
    pointer-events: none;
    overflow: hidden;
  }
  @media (max-width: 850px) {
    .layout { grid-template-columns: 1fr; }
  }
</style>
<h1>SVG to Sandsara track</h1>
<p id="subtitle" class="subtitle">Loading SVG…</p>
<div class="layout">
  <section class="controls" aria-label="Track generation controls">
    <div class="control">
      <label for="sampleSpacing">SVG sampling spacing</label>
      <div class="control-row">
        <input id="sampleSpacing" type="range" min="0.25" max="12" step="0.25" value="2">
        <span id="sampleSpacingValue" class="value">2.00</span>
      </div>
      <span class="hint">Lower values preserve more SVG detail.</span>
    </div>
    <div class="control">
      <label for="simplify">SVG simplification</label>
      <div class="control-row">
        <input id="simplify" type="range" min="0" max="8" step="0.25" value="0.75">
        <span id="simplifyValue" class="value">0.75</span>
      </div>
    </div>
    <div class="control">
      <label for="trackSpacing">Sandsara point spacing</label>
      <div class="control-row">
        <input id="trackSpacing" type="range" min="60" max="800" step="10" value="250">
        <span id="trackSpacingValue" class="value">250</span>
      </div>
      <span class="hint">Around 220–280 produces spacing similar to factory tracks.</span>
    </div>
    <div class="control">
      <label for="padding">Circular padding</label>
      <div class="control-row">
        <input id="padding" type="range" min="0" max="20" step="0.5" value="4">
        <span id="paddingValue" class="value">4.0%</span>
      </div>
    </div>
    <label class="control-row"><input id="edgeEntry" type="checkbox" checked> Start and finish at the outer edge</label>
    <button id="save" disabled>Save Sandsara .bin…</button>
    <div class="notice">
      Sandsara cannot lift the ball. Separate SVG paths are joined with the shortest available straight connector, which may become visible in the sand.
    </div>
  </section>
  <section>
    <canvas id="preview" aria-label="Generated Sandsara track preview"></canvas>
    <div id="stats" class="stats">Waiting for SVG…</div>
  </section>
</div>
<div id="svgMount" aria-hidden="true"></div>`;

const subtitle = requiredElement<HTMLElement>("subtitle");
const sampleSpacing = requiredElement<HTMLInputElement>("sampleSpacing");
const simplify = requiredElement<HTMLInputElement>("simplify");
const trackSpacing = requiredElement<HTMLInputElement>("trackSpacing");
const padding = requiredElement<HTMLInputElement>("padding");
const edgeEntry = requiredElement<HTMLInputElement>("edgeEntry");
const saveButton = requiredElement<HTMLButtonElement>("save");
const preview = requiredElement<HTMLCanvasElement>("preview");
const stats = requiredElement<HTMLElement>("stats");
const svgMount = requiredElement<HTMLElement>("svgMount");

let sourceSvg = "";
let sourceFilename = "artwork.svg";
let latestTrack: GeneratedTrack | undefined;
let generationTimer: number | undefined;
let mountedSvg: SVGSVGElement | undefined;

for (const input of [sampleSpacing, simplify, trackSpacing, padding, edgeEntry]) {
  input.addEventListener("input", scheduleGeneration);
  input.addEventListener("change", scheduleGeneration);
}

saveButton.addEventListener("click", () => {
  if (latestTrack === undefined) {
    return;
  }

  const flatPoints = latestTrack.points.flatMap(point => [point.x, point.y]);
  const message: SvgToTrackWebviewMessage = {
    type: "saveTrack",
    points: flatPoints,
    suggestedName: `Sandsara-trackNumber-${safeStem(sourceFilename)}.bin`
  };
  vscode.postMessage(message);
});

window.addEventListener("message", (event: MessageEvent<SvgToTrackHostMessage>) => {
  if (event.data.type !== "initialiseSvg") {
    return;
  }

  sourceSvg = event.data.svg;
  sourceFilename = event.data.filename;
  subtitle.textContent = sourceFilename;

  try {
    mountedSvg = mountSafeSvg(sourceSvg);
    generateTrack();
  } catch (error: unknown) {
    reportError(`The SVG could not be loaded: ${toErrorMessage(error)}`);
  }
});

new ResizeObserver(() => {
  if (latestTrack !== undefined) {
    drawTrack(latestTrack.points);
  }
}).observe(preview);

const readyMessage: SvgToTrackWebviewMessage = { type: "ready" };
vscode.postMessage(readyMessage);

function scheduleGeneration(): void {
  updateDisplayedValues();
  if (generationTimer !== undefined) {
    window.clearTimeout(generationTimer);
  }
  generationTimer = window.setTimeout(generateTrack, 150);
}

function generateTrack(): void {
  generationTimer = undefined;
  updateDisplayedValues();

  if (mountedSvg === undefined) {
    return;
  }

  try {
    stats.textContent = "Sampling SVG geometry…";
    const sampledPaths = sampleGeometry(
      mountedSvg,
      Math.max(0.1, numberValue(sampleSpacing, 2)),
      Math.max(0, numberValue(simplify, 0.75))
    );

    if (sampledPaths.length === 0) {
      throw new Error("No drawable SVG geometry was found.");
    }

    const fittedPaths = fitPathsToCircle(
      sampledPaths,
      clamp(numberValue(padding, 4), 0, 20)
    );
    const ordered = joinPathsByNearestEndpoint(fittedPaths);
    let joinedPoints = ordered.points;

    if (edgeEntry.checked && joinedPoints.length > 0) {
      const first = joinedPoints[0];
      const last = joinedPoints.at(-1);
      if (first !== undefined && last !== undefined) {
        joinedPoints = [pointOnOuterEdge(first), ...joinedPoints, pointOnOuterEdge(last)];
      }
    }

    const resampled = resamplePolyline(
      joinedPoints,
      clamp(numberValue(trackSpacing, 250), 20, 2000)
    );
    const integerPoints = deduplicateRoundedPoints(resampled);

    if (integerPoints.length < 2) {
      throw new Error("The SVG produced fewer than two usable track points.");
    }

    latestTrack = {
      points: integerPoints,
      sourcePathCount: sampledPaths.length,
      connectorCount: ordered.connectorCount,
      sourcePointCount: sampledPaths.reduce((sum, pathPoints) => sum + pathPoints.length, 0)
    };
    saveButton.disabled = false;
    drawTrack(integerPoints);

    const estimatedBytes = integerPoints.length * 6;
    stats.textContent =
      `${latestTrack.sourcePathCount.toLocaleString("en-GB")} SVG paths · ` +
      `${latestTrack.sourcePointCount.toLocaleString("en-GB")} sampled points · ` +
      `${latestTrack.connectorCount.toLocaleString("en-GB")} connectors · ` +
      `${integerPoints.length.toLocaleString("en-GB")} Sandsara points · ` +
      `${estimatedBytes.toLocaleString("en-GB")} bytes`;
  } catch (error: unknown) {
    latestTrack = undefined;
    saveButton.disabled = true;
    reportError(`Track generation failed: ${toErrorMessage(error)}`);
  }
}

function mountSafeSvg(svgText: string): SVGSVGElement {
  const parser = new DOMParser();
  const documentNode = parser.parseFromString(svgText, "image/svg+xml");
  const parserError = documentNode.querySelector("parsererror");
  if (parserError !== null) {
    throw new Error(parserError.textContent?.trim() || "The SVG is malformed.");
  }

  const root = documentNode.documentElement;
  if (root.localName.toLowerCase() !== "svg") {
    throw new Error("The selected file does not contain an SVG root element.");
  }

  const imported = document.importNode(root, true) as unknown as SVGSVGElement;
  imported.querySelectorAll("script, foreignObject, iframe, object, embed, image, use, a, style, link")
    .forEach(element => element.remove());

  for (const element of [imported, ...imported.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "href" || name === "xlink:href") {
        element.removeAttribute(attribute.name);
      }
    }
  }

  const viewBox = imported.viewBox.baseVal;
  const width = viewBox.width > 0
    ? viewBox.width
    : parsePositiveNumber(imported.getAttribute("width"), 1000);
  const height = viewBox.height > 0
    ? viewBox.height
    : parsePositiveNumber(imported.getAttribute("height"), 1000);

  if (viewBox.width <= 0 || viewBox.height <= 0) {
    imported.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }

  imported.setAttribute("width", String(width));
  imported.setAttribute("height", String(height));
  imported.style.display = "block";
  svgMount.replaceChildren(imported);
  return imported;
}

function sampleGeometry(
  svg: SVGSVGElement,
  spacing: number,
  simplificationTolerance: number
): Point[][] {
  const geometryElements = [
    ...svg.querySelectorAll<SVGGeometryElement>(
      "path, polyline, polygon, line, rect, circle, ellipse"
    )
  ];
  const rootMatrix = svg.getCTM();
  const output: Point[][] = [];

  for (const element of geometryElements) {
    let totalLength: number;
    try {
      totalLength = element.getTotalLength();
    } catch {
      continue;
    }

    if (!Number.isFinite(totalLength) || totalLength <= 0) {
      continue;
    }

    const elementMatrix = element.getCTM();
    let localToRoot: DOMMatrix | undefined;
    if (rootMatrix !== null && elementMatrix !== null) {
      try {
        localToRoot = rootMatrix.inverse().multiply(elementMatrix);
      } catch {
        localToRoot = undefined;
      }
    }

    const sampleCount = Math.max(1, Math.ceil(totalLength / spacing));
    const points: Point[] = [];

    for (let index = 0; index <= sampleCount; index++) {
      const distance = totalLength * index / sampleCount;
      const svgPoint = element.getPointAtLength(distance);
      const transformed = localToRoot === undefined
        ? { x: svgPoint.x, y: svgPoint.y }
        : new DOMPoint(svgPoint.x, svgPoint.y).matrixTransform(localToRoot);
      const previous = points.at(-1);

      if (
        previous === undefined ||
        Math.hypot(transformed.x - previous.x, transformed.y - previous.y) > 1e-6
      ) {
        points.push({ x: transformed.x, y: transformed.y });
      }
    }

    const simplified = simplifyPolyline(points, simplificationTolerance);
    if (simplified.length >= 2) {
      output.push(simplified);
    }
  }

  return output;
}

function fitPathsToCircle(
  paths: readonly (readonly Point[])[],
  paddingPercent: number
): Point[][] {
  const allPoints = paths.flat();
  if (allPoints.length === 0) {
    return [];
  }

  let minimumX = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;

  for (const point of allPoints) {
    minimumX = Math.min(minimumX, point.x);
    maximumX = Math.max(maximumX, point.x);
    minimumY = Math.min(minimumY, point.y);
    maximumY = Math.max(maximumY, point.y);
  }

  const centreX = (minimumX + maximumX) / 2;
  const centreY = (minimumY + maximumY) / 2;
  let maximumRadius = 0;

  for (const point of allPoints) {
    maximumRadius = Math.max(
      maximumRadius,
      Math.hypot(point.x - centreX, point.y - centreY)
    );
  }

  if (maximumRadius <= 0) {
    throw new Error("The SVG geometry has no measurable size.");
  }

  const usableRadius = SANDSARA_RADIUS * (1 - paddingPercent / 100);
  const scale = usableRadius / maximumRadius;

  return paths.map(pathPoints => pathPoints.map(point => ({
    x: (point.x - centreX) * scale,
    y: -(point.y - centreY) * scale
  })));
}

function joinPathsByNearestEndpoint(
  paths: readonly (readonly Point[])[]
): { readonly points: Point[]; readonly connectorCount: number } {
  const remaining = paths.map(pathPoints => [...pathPoints]);
  const output: Point[] = [];
  let connectorCount = 0;

  let firstPathIndex = -1;
  let reverseFirst = false;
  let greatestEndpointRadius = -1;

  for (let index = 0; index < remaining.length; index++) {
    const pathPoints = remaining[index];
    const first = pathPoints?.[0];
    const last = pathPoints?.at(-1);
    if (first === undefined || last === undefined) {
      continue;
    }

    const firstRadius = Math.hypot(first.x, first.y);
    const lastRadius = Math.hypot(last.x, last.y);
    if (firstRadius > greatestEndpointRadius) {
      greatestEndpointRadius = firstRadius;
      firstPathIndex = index;
      reverseFirst = false;
    }
    if (lastRadius > greatestEndpointRadius) {
      greatestEndpointRadius = lastRadius;
      firstPathIndex = index;
      reverseFirst = true;
    }
  }

  if (firstPathIndex < 0) {
    return { points: [], connectorCount: 0 };
  }

  const firstPath = remaining.splice(firstPathIndex, 1)[0];
  if (firstPath === undefined) {
    return { points: [], connectorCount: 0 };
  }
  output.push(...(reverseFirst ? firstPath.reverse() : firstPath));

  while (remaining.length > 0) {
    const current = output.at(-1);
    if (current === undefined) {
      break;
    }

    let bestIndex = -1;
    let bestReverse = false;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < remaining.length; index++) {
      const candidate = remaining[index];
      const start = candidate?.[0];
      const end = candidate?.at(-1);
      if (start === undefined || end === undefined) {
        continue;
      }

      const startDistance = squaredDistance(current, start);
      if (startDistance < bestDistance) {
        bestDistance = startDistance;
        bestIndex = index;
        bestReverse = false;
      }

      const endDistance = squaredDistance(current, end);
      if (endDistance < bestDistance) {
        bestDistance = endDistance;
        bestIndex = index;
        bestReverse = true;
      }
    }

    if (bestIndex < 0) {
      break;
    }

    const nextPath = remaining.splice(bestIndex, 1)[0];
    if (nextPath === undefined) {
      continue;
    }
    if (bestReverse) {
      nextPath.reverse();
    }

    const nextStart = nextPath[0];
    if (nextStart !== undefined && squaredDistance(current, nextStart) > 1e-9) {
      connectorCount++;
    }
    output.push(...nextPath);
  }

  return { points: removeAdjacentDuplicates(output), connectorCount };
}

function resamplePolyline(points: readonly Point[], spacing: number): Point[] {
  const first = points[0];
  if (first === undefined) {
    return [];
  }

  const output: Point[] = [first];
  let previous = first;
  let carriedDistance = 0;

  for (let index = 1; index < points.length; index++) {
    const target = points[index];
    if (target === undefined) {
      continue;
    }

    let segmentStart = previous;
    let segmentLength = Math.hypot(
      target.x - segmentStart.x,
      target.y - segmentStart.y
    );

    while (segmentLength > 0 && carriedDistance + segmentLength >= spacing) {
      const needed = spacing - carriedDistance;
      const ratio = needed / segmentLength;
      const sampled = {
        x: segmentStart.x + (target.x - segmentStart.x) * ratio,
        y: segmentStart.y + (target.y - segmentStart.y) * ratio
      };
      output.push(sampled);
      segmentStart = sampled;
      segmentLength = Math.hypot(
        target.x - segmentStart.x,
        target.y - segmentStart.y
      );
      carriedDistance = 0;
    }

    carriedDistance += segmentLength;
    previous = target;
  }

  const finalPoint = points.at(-1);
  const outputFinal = output.at(-1);
  if (
    finalPoint !== undefined &&
    outputFinal !== undefined &&
    squaredDistance(finalPoint, outputFinal) > 1e-9
  ) {
    output.push(finalPoint);
  }

  return output;
}

function deduplicateRoundedPoints(points: readonly Point[]): Point[] {
  const output: Point[] = [];

  for (const point of points) {
    const radius = Math.hypot(point.x, point.y);
    const scale = radius > SANDSARA_RADIUS ? SANDSARA_RADIUS / radius : 1;
    const rounded = {
      x: clampInteger(Math.round(point.x * scale), -32_768, 32_767),
      y: clampInteger(Math.round(point.y * scale), -32_768, 32_767)
    };
    const previous = output.at(-1);
    if (previous === undefined || previous.x !== rounded.x || previous.y !== rounded.y) {
      output.push(rounded);
    }
  }

  return output;
}

function pointOnOuterEdge(point: Point): Point {
  const radius = Math.hypot(point.x, point.y);
  if (radius < 1e-9) {
    return { x: -SANDSARA_RADIUS, y: 0 };
  }

  const scale = SANDSARA_RADIUS / radius;
  return { x: point.x * scale, y: point.y * scale };
}

function removeAdjacentDuplicates(points: readonly Point[]): Point[] {
  const output: Point[] = [];
  for (const point of points) {
    const previous = output.at(-1);
    if (previous === undefined || squaredDistance(previous, point) > 1e-12) {
      output.push(point);
    }
  }
  return output;
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
    return squaredDistance(point, start);
  }

  const projection = clamp(
    ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) /
      (deltaX * deltaX + deltaY * deltaY),
    0,
    1
  );
  return squaredDistance(point, {
    x: start.x + projection * deltaX,
    y: start.y + projection * deltaY
  });
}

function drawTrack(points: readonly Point[]): void {
  const context = preview.getContext("2d");
  if (context === null) {
    return;
  }

  const ratio = window.devicePixelRatio || 1;
  const bounds = preview.getBoundingClientRect();
  const size = Math.max(1, Math.floor(bounds.width * ratio));
  preview.width = size;
  preview.height = size;

  const paddingPixels = 18 * ratio;
  const radius = size / 2 - paddingPixels;
  const centre = size / 2;
  const scale = radius / SANDSARA_RADIUS;
  const styles = getComputedStyle(document.body);

  context.clearRect(0, 0, size, size);
  context.strokeStyle = styles.getPropertyValue("--vscode-panel-border");
  context.lineWidth = ratio;
  context.beginPath();
  context.arc(centre, centre, radius, 0, Math.PI * 2);
  context.stroke();

  const first = points[0];
  if (first === undefined) {
    return;
  }

  context.strokeStyle = styles.getPropertyValue("--vscode-editor-foreground");
  context.lineWidth = Math.max(1, ratio * 0.7);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(centre + first.x * scale, centre - first.y * scale);

  for (let index = 1; index < points.length; index++) {
    const point = points[index];
    if (point !== undefined) {
      context.lineTo(centre + point.x * scale, centre - point.y * scale);
    }
  }
  context.stroke();

  drawMarker(context, first, "--vscode-charts-green", centre, scale, ratio);
  const last = points.at(-1);
  if (last !== undefined) {
    drawMarker(context, last, "--vscode-charts-red", centre, scale, ratio);
  }
}

function drawMarker(
  context: CanvasRenderingContext2D,
  point: Point,
  colourVariable: string,
  centre: number,
  scale: number,
  ratio: number
): void {
  context.fillStyle = getComputedStyle(document.body).getPropertyValue(colourVariable);
  context.beginPath();
  context.arc(
    centre + point.x * scale,
    centre - point.y * scale,
    4 * ratio,
    0,
    Math.PI * 2
  );
  context.fill();
}

function updateDisplayedValues(): void {
  requiredElement<HTMLElement>("sampleSpacingValue").textContent =
    numberValue(sampleSpacing, 2).toFixed(2);
  requiredElement<HTMLElement>("simplifyValue").textContent =
    numberValue(simplify, 0.75).toFixed(2);
  requiredElement<HTMLElement>("trackSpacingValue").textContent =
    Math.round(numberValue(trackSpacing, 250)).toLocaleString("en-GB");
  requiredElement<HTMLElement>("paddingValue").textContent =
    `${numberValue(padding, 4).toFixed(1)}%`;
}

function squaredDistance(first: Point, second: Point): number {
  return (first.x - second.x) ** 2 + (first.y - second.y) ** 2;
}

function safeStem(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  const stem = lastDot > 0 ? filename.slice(0, lastDot) : filename;
  const safe = stem.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe.length > 0 ? safe : "custom";
}

function parsePositiveNumber(value: string | null, fallback: number): number {
  if (value === null) {
    return fallback;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing webview element: ${id}`);
  }
  return element as T;
}

function reportError(message: string): void {
  stats.textContent = message;
  const outgoing: SvgToTrackWebviewMessage = {
    type: "showError",
    message
  };
  vscode.postMessage(outgoing);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
