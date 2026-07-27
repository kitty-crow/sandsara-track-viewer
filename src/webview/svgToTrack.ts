import type {
  SvgToTrackHostMessage,
  SvgToTrackWebviewMessage
} from "./types";
import {
  cancelRoute,
  routePth,
  type RouteRes,
  type RouteProg
} from "./routerWorkerClient";

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
  .route-progress {
    display: grid;
    gap: 7px;
    padding: 10px;
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-editor-background);
  }
  .route-progress[hidden] { display: none; }
  .route-progress-heading {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .route-progress progress { width: 100%; }
  .route-progress-detail { color: var(--vscode-descriptionForeground); font-size: 0.9rem; }
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
      <label for="padding">Overscan</label>
      <div class="control-row">
        <input id="padding" type="range" min="-1" max="1" step="0.01" value="-0.04">
        <span id="paddingValue" class="value">-0.04</span>
      </div>
      <span class="hint">Positive values enlarge and crop the artwork. Negative values shrink it inside the circle.</span>
    </div>
    <label class="control-row"><input id="edgeEntry" type="checkbox"> Start and finish at the outer edge</label>
    <button id="save" disabled>Save Sandsara .bin…</button>
    <div id="routeProgress" class="route-progress" aria-live="polite" hidden>
      <div class="route-progress-heading"><strong id="routeProgressStage">Preparing route…</strong><span id="routeProgressPercent">0%</span></div>
      <progress id="routeProgressBar" max="100" value="0">0%</progress>
      <div id="routeProgressDetail" class="route-progress-detail">Waiting for the first traced path.</div>
    </div>
    <div class="notice">
      Sandsara cannot lift the ball. The generator retraces completed lines where possible and uses the outer edge when that avoids a line across the artwork. Isolated shapes may still need a short bridge.
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
const routeProgress = requiredElement<HTMLElement>("routeProgress");
const routeProgressStage = requiredElement<HTMLElement>("routeProgressStage");
const routeProgressPercent = requiredElement<HTMLElement>("routeProgressPercent");
const routeProgressBar = requiredElement<HTMLProgressElement>("routeProgressBar");
const routeProgressDetail = requiredElement<HTMLElement>("routeProgressDetail");
const svgMount = requiredElement<HTMLElement>("svgMount");

let sourceSvg = "";
let sourceFilename = "artwork.svg";
let latestTrack: GeneratedTrack | undefined;
let generationTimer: number | undefined;
let generationSerial = 0;
let mountedSvg: SVGSVGElement | undefined;
let livePreviewPoints: Point[] = [];
let sourceRevision = 0;
let sampledCache: { readonly key: string; readonly paths: Point[][] } | undefined;
let fittedCache: { readonly key: string; readonly paths: Point[][] } | undefined;
let routedCache: {
  readonly key: string;
  readonly result: RouteRes;
  readonly sourcePathCount: number;
  readonly sourcePointCount: number;
} | undefined;

for (const input of [sampleSpacing, simplify, padding, edgeEntry]) {
  input.addEventListener("input", scheduleGeneration);
  input.addEventListener("change", scheduleGeneration);
}
trackSpacing.addEventListener("input", refreshOutputSpacing);
trackSpacing.addEventListener("change", refreshOutputSpacing);

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
  sourceRevision += 1;
  sampledCache = undefined;
  fittedCache = undefined;
  routedCache = undefined;
  cancelRoute();

  try {
    mountedSvg = mountSafeSvg(sourceSvg);
    generationSerial++;
    void generateTrack(generationSerial);
  } catch (error: unknown) {
    reportError(`The SVG could not be loaded: ${errMsg(error)}`);
  }
});

new ResizeObserver(() => {
  if (latestTrack !== undefined) {
    drawTrack(latestTrack.points);
  } else if (livePreviewPoints.length > 0) {
    drawTrack(livePreviewPoints);
  }
}).observe(preview);

const readyMessage: SvgToTrackWebviewMessage = { type: "ready" };
vscode.postMessage(readyMessage);

function scheduleGeneration(): void {
  updateDisplayedValues();
  if (generationTimer !== undefined) {
    window.clearTimeout(generationTimer);
  }
  cancelRoute();
  generationSerial++;
  const requestSerial = generationSerial;
  generationTimer = window.setTimeout(() => void generateTrack(requestSerial), 150);
}

function refreshOutputSpacing(): void {
  updateDisplayedValues();
  if (routedCache !== undefined) {
    renderRoutedTrack(
      routedCache.result,
      routedCache.sourcePathCount,
      routedCache.sourcePointCount
    );
  }
}

async function generateTrack(requestSerial: number): Promise<void> {
  generationTimer = undefined;
  updateDisplayedValues();

  if (mountedSvg === undefined || requestSerial !== generationSerial) {
    return;
  }

  latestTrack = undefined;
  livePreviewPoints = [];
  saveButton.disabled = true;
  stats.removeAttribute("data-router-engine");
  beginRoutingProgress();

  try {
    const samplingKey = [
      sourceRevision,
      Math.max(0.1, numberValue(sampleSpacing, 2)),
      Math.max(0, numberValue(simplify, 0.75))
    ].join(":");
    let sampledPaths: Point[][];
    if (sampledCache?.key === samplingKey) {
      stats.textContent = "Reusing sampled SVG geometry…";
      sampledPaths = sampledCache.paths;
    } else {
      stats.textContent = "Sampling SVG geometry…";
      sampledPaths = sampleGeometry(
        mountedSvg,
        Math.max(0.1, numberValue(sampleSpacing, 2)),
        Math.max(0, numberValue(simplify, 0.75))
      );
      sampledCache = { key: samplingKey, paths: sampledPaths };
      fittedCache = undefined;
      routedCache = undefined;
    }

    if (sampledPaths.length === 0) {
      throw new Error("No drawable SVG geometry was found.");
    }

    const fitKey = `${samplingKey}:${clamp(numberValue(padding, -0.04), -1, 1)}`;
    let fittedPaths: Point[][];
    if (fittedCache?.key === fitKey) {
      stats.textContent = "Reusing fitted geometry…";
      fittedPaths = fittedCache.paths;
    } else {
      fittedPaths = fitPathsToCircle(
        sampledPaths,
        clamp(numberValue(padding, -0.04), -1, 1)
      );
      fittedCache = { key: fitKey, paths: fittedPaths };
      routedCache = undefined;
    }

    const sourcePointCount = sampledPaths.reduce(
      (sum, pathPoints) => sum + pathPoints.length,
      0
    );
    const routeKey = `${fitKey}:${edgeEntry.checked ? 1 : 0}`;
    let ordered: RouteRes;
    if (routedCache?.key === routeKey) {
      stats.textContent = "Reusing the completed route…";
      ordered = routedCache.result;
    } else {
      stats.textContent = "Finding the best route…";
      await new Promise<void>(resolve => window.setTimeout(resolve, 0));
      ordered = await routePth(
        fittedPaths,
        SANDSARA_RADIUS,
        edgeEntry.checked,
        progress => {
          if (requestSerial !== generationSerial) {
            return;
          }
          if (progress.restored) {
            livePreviewPoints = [...progress.points];
          } else {
            livePreviewPoints.push(...progress.points);
          }
          if (livePreviewPoints.length > 0) {
            drawTrack(livePreviewPoints);
          }
          updateRoutingProgress(progress);
        }
      );
      routedCache = {
        key: routeKey,
        result: ordered,
        sourcePathCount: sampledPaths.length,
        sourcePointCount
      };
    }
    if (requestSerial !== generationSerial) {
      return;
    }

    renderRoutedTrack(ordered, sampledPaths.length, sourcePointCount);
  } catch (error: unknown) {
    if (requestSerial !== generationSerial) {
      return;
    }
    latestTrack = undefined;
    saveButton.disabled = true;
    reportError(`Track generation failed: ${errMsg(error)}`);
  }
}


function renderRoutedTrack(
  ordered: RouteRes,
  sourcePathCount: number,
  sourcePointCount: number
): void {
  const joinedPoints = ordered.points;

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
    sourcePathCount,
    connectorCount: ordered.connectorCount,
    sourcePointCount
  };
  saveButton.disabled = false;
  livePreviewPoints = [...integerPoints];
  drawTrack(integerPoints);
  completeRoutingProgress(sourcePathCount);

  const estimatedBytes = integerPoints.length * 6;
  stats.dataset.routerEngine = ordered.engine;
  stats.textContent =
    `${sourcePathCount.toLocaleString("en-GB")} SVG paths · ` +
    `${sourcePointCount.toLocaleString("en-GB")} sampled points · ` +
    `${ordered.connectorCount.toLocaleString("en-GB")} connectors · ` +
    `${integerPoints.length.toLocaleString("en-GB")} Sandsara points · ` +
    `${estimatedBytes.toLocaleString("en-GB")} bytes`;
}


function beginRoutingProgress(): void {
  routeProgress.hidden = false;
  routeProgressStage.textContent = "Preparing radial route…";
  routeProgressPercent.textContent = "0%";
  routeProgressBar.value = 0;
  routeProgressBar.textContent = "0%";
  routeProgressDetail.textContent = "Waiting for the first traced path.";
}

function updateRoutingProgress(progress: RouteProg): void {
  const percentage = Math.max(0, Math.min(100, Math.round(progress.percentage)));
  const etaText = formatEta(progress.etaMs);
  routeProgress.hidden = false;
  routeProgressStage.textContent =
    `Tracing path ${progress.completedPaths.toLocaleString("en-GB")} of ${progress.totalPaths.toLocaleString("en-GB")}`;
  routeProgressPercent.textContent = `${percentage}%`;
  routeProgressBar.value = percentage;
  routeProgressBar.textContent = `${percentage}%`;
  routeProgressDetail.textContent = etaText;
  stats.textContent = `${routeProgressStage.textContent} · ${percentage}% · ${etaText}`;
  window.dispatchEvent(new CustomEvent("sandsara-routing-progress", {
    detail: {
      completedPaths: progress.completedPaths,
      totalPaths: progress.totalPaths,
      percentage,
      etaText
    }
  }));
}

function completeRoutingProgress(totalPaths: number): void {
  routeProgress.hidden = false;
  routeProgressStage.textContent =
    `Traced ${totalPaths.toLocaleString("en-GB")} ${totalPaths === 1 ? "path" : "paths"}`;
  routeProgressPercent.textContent = "100%";
  routeProgressBar.value = 100;
  routeProgressBar.textContent = "100%";
  routeProgressDetail.textContent = "Route calculation complete.";
}

function formatEta(etaMs: number | undefined): string {
  if (etaMs === undefined || !Number.isFinite(etaMs) || etaMs <= 0) {
    return "Estimating time remaining…";
  }
  const seconds = Math.max(1, Math.round(etaMs / 1000));
  if (seconds < 60) {
    return `About ${seconds} ${seconds === 1 ? "second" : "seconds"} remaining`;
  }
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `About ${minutes} ${minutes === 1 ? "minute" : "minutes"} remaining`;
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
  overscan: number
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

  const usableRadius = SANDSARA_RADIUS * (1 + overscan);
  const scale = usableRadius / maximumRadius;

  const fittedPaths = paths.map(pathPoints => pathPoints.map(point => ({
    x: (point.x - centreX) * scale,
    y: -(point.y - centreY) * scale
  })));

  return overscan > 0
    ? clipPathsToCircle(fittedPaths, SANDSARA_RADIUS)
    : fittedPaths;
}

function clipPathsToCircle(
  paths: readonly (readonly Point[])[],
  radius: number
): Point[][] {
  const clippedPaths: Point[][] = [];
  const joinToleranceSquared = 1e-8;

  for (const pathPoints of paths) {
    let current: Point[] = [];

    for (let index = 1; index < pathPoints.length; index++) {
      const start = pathPoints[index - 1];
      const end = pathPoints[index];
      if (start === undefined || end === undefined) {
        continue;
      }

      const clipped = clipSegmentToCircle(start, end, radius);
      if (clipped === undefined) {
        if (current.length >= 2) {
          clippedPaths.push(current);
        }
        current = [];
        continue;
      }

      const [clippedStart, clippedEnd] = clipped;
      const previous = current.at(-1);
      if (
        previous === undefined ||
        dist2(previous, clippedStart) > joinToleranceSquared
      ) {
        if (current.length >= 2) {
          clippedPaths.push(current);
        }
        current = [clippedStart];
      }

      const currentEnd = current.at(-1);
      if (
        currentEnd === undefined ||
        dist2(currentEnd, clippedEnd) > joinToleranceSquared
      ) {
        current.push(clippedEnd);
      }
    }

    if (current.length >= 2) {
      clippedPaths.push(current);
    }
  }

  return clippedPaths;
}

function clipSegmentToCircle(
  start: Point,
  end: Point,
  radius: number
): readonly [Point, Point] | undefined {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const quadraticA = deltaX * deltaX + deltaY * deltaY;
  const radiusSquared = radius * radius;

  if (quadraticA <= 1e-12) {
    return start.x * start.x + start.y * start.y <= radiusSquared
      ? [start, end]
      : undefined;
  }

  const quadraticB = 2 * (start.x * deltaX + start.y * deltaY);
  const quadraticC = start.x * start.x + start.y * start.y - radiusSquared;
  const discriminant = quadraticB * quadraticB - 4 * quadraticA * quadraticC;
  const boundaries = [0, 1];

  if (discriminant >= 0) {
    const root = Math.sqrt(discriminant);
    const first = (-quadraticB - root) / (2 * quadraticA);
    const second = (-quadraticB + root) / (2 * quadraticA);
    if (first > 0 && first < 1) boundaries.push(first);
    if (second > 0 && second < 1) boundaries.push(second);
  }

  boundaries.sort((left, right) => left - right);
  for (let index = 1; index < boundaries.length; index++) {
    const intervalStart = boundaries[index - 1];
    const intervalEnd = boundaries[index];
    if (intervalStart === undefined || intervalEnd === undefined) {
      continue;
    }
    const midpoint = (intervalStart + intervalEnd) / 2;
    const midpointX = start.x + deltaX * midpoint;
    const midpointY = start.y + deltaY * midpoint;
    if (midpointX * midpointX + midpointY * midpointY <= radiusSquared + 1e-7) {
      return [
        {
          x: start.x + deltaX * intervalStart,
          y: start.y + deltaY * intervalStart
        },
        {
          x: start.x + deltaX * intervalEnd,
          y: start.y + deltaY * intervalEnd
        }
      ];
    }
  }

  return undefined;
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
    dist2(finalPoint, outputFinal) > 1e-9
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
      x: clampInt(Math.round(point.x * scale), -32_768, 32_767),
      y: clampInt(Math.round(point.y * scale), -32_768, 32_767)
    };
    const previous = output.at(-1);
    if (previous === undefined || previous.x !== rounded.x || previous.y !== rounded.y) {
      output.push(rounded);
    }
  }

  return output;
}

function edgePt(point: Point): Point {
  const radius = Math.hypot(point.x, point.y);
  if (radius < 1e-9) {
    return { x: -SANDSARA_RADIUS, y: 0 };
  }

  const scale = SANDSARA_RADIUS / radius;
  return { x: point.x * scale, y: point.y * scale };
}

function uniqPts(points: readonly Point[]): Point[] {
  const output: Point[] = [];
  for (const point of points) {
    const previous = output.at(-1);
    if (previous === undefined || dist2(previous, point) > 1e-12) {
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
    return dist2(point, start);
  }

  const projection = clamp(
    ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) /
      (deltaX * deltaX + deltaY * deltaY),
    0,
    1
  );
  return dist2(point, {
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
    numberValue(padding, -0.04).toFixed(2);
}

function dist2(first: Point, second: Point): number {
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

function clampInt(value: number, minimum: number, maximum: number): number {
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

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
