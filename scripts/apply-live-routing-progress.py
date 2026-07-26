from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one {label}; found {count}")
    return text.replace(old, new, 1)


# Incremental Baguette-compatible router API.
router_path = "src/router-wasm/router.ts"
router = read(router_path)
router = replace_once(
    router,
    "let startFromOuterEdgeValue: I32 = 1;",
    "let startFromOuterEdgeValue: I32 = 0;",
    "outer-edge default",
)
router = replace_once(
    router,
    "let lastPolylineStart: I32 = 0;\nlet lastPolylineCount: I32 = 0;",
    """let lastPolylineStart: I32 = 0;
let lastPolylineCount: I32 = 0;
let runState: I32 = 0;
let runOrderIndex: I32 = 0;
let runCurrentNode: I32 = -1;""",
    "incremental run state",
)
router = replace_once(
    router,
    """export function routerVersion(): I32 {
  return 1;
}""",
    """export function routerVersion(): I32 {
  return 2;
}""",
    "router ABI version",
)
run_pattern = re.compile(
    r"export function routerRun\(\): I32 \{.*?\n\}\n\nexport function routerOutputCount",
    re.S,
)
run_replacement = """export function routerBegin(): I32 {
  if (configured === 0) {
    return -1;
  }

  resetRunState();
  computeProfiles();
  buildUntouchedSegments();
  runState = 0;
  runOrderIndex = 0;
  runCurrentNode = -1;

  let pathIndex: I32 = 0;
  while (pathIndex < pathCountValue) {
    pathActive[pathIndex] = pathLength[pathIndex] >= 2 ? 1 : 0;
    pathIndex += 1;
  }

  buildRadialOrder();
  if (routeOrder.length === 0) {
    runState = 2;
    return 0;
  }

  const firstPath: I32 = routeOrder[0];
  selectFirstEntryForPath(firstPath);
  if (firstBestSet === 0) {
    return -2;
  }

  appendPathWalk(firstPath, firstBestEntry);
  if (lastPolylineCount < 2) {
    return -3;
  }

  runCurrentNode = graphAddPolyline(lastPolylineStart, lastPolylineCount);
  pathActive[firstPath] = 0;
  runOrderIndex = 1;
  runState = runOrderIndex >= routeOrder.length ? 2 : 1;
  return 0;
}

export function routerStep(): I32 {
  if (runState === 0) {
    return -6;
  }
  if (runState === 2) {
    return 0;
  }

  const targetPath: I32 = routeOrder[runOrderIndex];
  selectConnectionToPath(targetPath, runCurrentNode);
  if (bestSet === 0 || bestAnchor < 0) {
    return -4;
  }

  graphShortestPaths(runCurrentNode);
  if (bestAnchor >= shortestDistance.length || shortestDistance[bestAnchor] >= LARGE_DISTANCE) {
    return -5;
  }
  appendGraphPath(bestAnchor);

  const anchorX: F64 = graphNodeX[bestAnchor];
  const anchorY: F64 = graphNodeY[bestAnchor];
  const entryAbsolute: I32 = pathStart[targetPath] + bestEntry;
  const entryX: F64 = inputX[entryAbsolute];
  const entryY: F64 = inputY[entryAbsolute];

  if (bestConnected === 0) {
    const connectorStart: I32 = outputX.length > 0 ? outputX.length - 1 : 0;
    if (bestMode === 1) {
      appendOuterConnector(anchorX, anchorY, entryX, entryY);
    } else {
      appendSampledLine(anchorX, anchorY, entryX, entryY);
    }
    const connectorPointCount: I32 = outputX.length - connectorStart;
    if (connectorPointCount >= 2) {
      graphAddPolyline(connectorStart, connectorPointCount);
    }
    connectorCountValue += 1;
    newConnectorDistanceValue += bestNewDistance;
    crossingCountValue += bestCrossings;
  }

  appendPathWalk(targetPath, bestEntry);
  if (lastPolylineCount >= 2) {
    runCurrentNode = graphAddPolyline(lastPolylineStart, lastPolylineCount);
  }
  pathActive[targetPath] = 0;
  runOrderIndex += 1;
  if (runOrderIndex >= routeOrder.length) {
    runState = 2;
  }
  return 1;
}

export function routerIsComplete(): I32 {
  return runState === 2 ? 1 : 0;
}

export function routerCompletedPathCount(): I32 {
  return runOrderIndex;
}

export function routerTotalPathCount(): I32 {
  return routeOrder.length;
}

export function routerRun(): I32 {
  const beginStatus: I32 = routerBegin();
  if (beginStatus < 0) {
    return beginStatus;
  }
  while (routerIsComplete() === 0) {
    const stepStatus: I32 = routerStep();
    if (stepStatus < 0) {
      return stepStatus;
    }
  }
  return outputX.length;
}

export function routerOutputCount"""
router, count = run_pattern.subn(run_replacement, router, count=1)
if count != 1:
    raise SystemExit(f"Expected one routerRun block; found {count}")
write(router_path, router)

# Export the incremental ABI through Baguette.
config_path = "baguette.router.config.json"
config = json.loads(read(config_path))
exports = config["abi"]["exports"]
for name in [
    "routerBegin",
    "routerStep",
    "routerIsComplete",
    "routerCompletedPathCount",
    "routerTotalPathCount",
]:
    if name not in exports:
        exports.insert(exports.index("routerRun"), name)
write(config_path, json.dumps(config, indent=2) + "\n")

worker = r'''interface RouterWasmExports {
  readonly routerVersion: () => number;
  readonly routerConfigure: (
    pathCount: number,
    pointCount: number,
    outerRadius: number,
    startFromOuterEdge: number
  ) => number;
  readonly routerSetPath: (pathIndex: number, start: number, length: number) => number;
  readonly routerSetPoint: (pointIndex: number, x: number, y: number) => number;
  readonly routerBegin: () => number;
  readonly routerStep: () => number;
  readonly routerIsComplete: () => number;
  readonly routerCompletedPathCount: () => number;
  readonly routerTotalPathCount: () => number;
  readonly routerOutputCount: () => number;
  readonly routerOutputX: (index: number) => number;
  readonly routerOutputY: (index: number) => number;
  readonly routerConnectorCount: () => number;
  readonly routerNewConnectorDistance: () => number;
  readonly routerCrossingCount: () => number;
}

interface WorkerRouteRequest {
  readonly type: "route";
  readonly id: number;
  readonly coordinates: Float64Array;
  readonly offsets: Uint32Array;
  readonly outerRadius: number;
  readonly startFromOuterEdge: boolean;
}

interface WorkerRouteProgress {
  readonly type: "progress";
  readonly id: number;
  readonly coordinates: Float64Array;
  readonly completedPaths: number;
  readonly totalPaths: number;
}

interface WorkerRouteSuccess {
  readonly type: "routed";
  readonly id: number;
  readonly coordinates: Float64Array;
  readonly connectorCount: number;
  readonly newConnectorDistance: number;
  readonly crossingCount: number;
}

interface WorkerRouteFailure {
  readonly type: "error";
  readonly id: number;
  readonly message: string;
}

type WorkerRouteResponse = WorkerRouteProgress | WorkerRouteSuccess | WorkerRouteFailure;

interface WorkerHost {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<WorkerRouteRequest>) => void
  ): void;
  postMessage(message: WorkerRouteResponse, transfer?: Transferable[]): void;
}

const workerHost = globalThis as unknown as WorkerHost;
let exportsPromise: Promise<RouterWasmExports> | undefined;

workerHost.addEventListener("message", event => {
  if (event.data.type === "route") {
    void route(event.data);
  }
});

async function route(request: WorkerRouteRequest): Promise<void> {
  try {
    const wasm = await loadRouter();
    const pathCount = request.offsets.length - 1;
    const pointCount = Math.floor(request.coordinates.length / 2);
    checkStatus(wasm.routerConfigure(
      pathCount,
      pointCount,
      request.outerRadius,
      request.startFromOuterEdge ? 1 : 0
    ), "configure");

    for (let pathIndex = 0; pathIndex < pathCount; pathIndex++) {
      const start = request.offsets[pathIndex] ?? 0;
      const end = request.offsets[pathIndex + 1] ?? start;
      checkStatus(wasm.routerSetPath(pathIndex, start, end - start), "set path");
    }

    for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
      checkStatus(wasm.routerSetPoint(
        pointIndex,
        request.coordinates[pointIndex * 2] ?? 0,
        request.coordinates[pointIndex * 2 + 1] ?? 0
      ), "set point");
    }

    checkStatus(wasm.routerBegin(), "begin routing");
    let sentOutputCount = postProgress(wasm, request.id, 0);

    while (wasm.routerIsComplete() === 0) {
      await yieldWorker();
      checkStatus(wasm.routerStep(), "trace the next path");
      sentOutputCount = postProgress(wasm, request.id, sentOutputCount);
    }

    const outputCount = wasm.routerOutputCount();
    const coordinates = readCoordinates(wasm, 0, outputCount);
    const response: WorkerRouteSuccess = {
      type: "routed",
      id: request.id,
      coordinates,
      connectorCount: wasm.routerConnectorCount(),
      newConnectorDistance: wasm.routerNewConnectorDistance(),
      crossingCount: wasm.routerCrossingCount()
    };
    workerHost.postMessage(response, [coordinates.buffer]);
  } catch (error: unknown) {
    const response: WorkerRouteFailure = {
      type: "error",
      id: request.id,
      message: error instanceof Error ? error.message : String(error)
    };
    workerHost.postMessage(response);
  }
}

function postProgress(wasm: RouterWasmExports, id: number, previousCount: number): number {
  const outputCount = wasm.routerOutputCount();
  const coordinates = readCoordinates(wasm, previousCount, outputCount);
  const response: WorkerRouteProgress = {
    type: "progress",
    id,
    coordinates,
    completedPaths: wasm.routerCompletedPathCount(),
    totalPaths: wasm.routerTotalPathCount()
  };
  workerHost.postMessage(response, [coordinates.buffer]);
  return outputCount;
}

function readCoordinates(
  wasm: RouterWasmExports,
  startPoint: number,
  endPoint: number
): Float64Array {
  const count = Math.max(0, endPoint - startPoint);
  const coordinates = new Float64Array(count * 2);
  for (let offset = 0; offset < count; offset++) {
    const index = startPoint + offset;
    coordinates[offset * 2] = wasm.routerOutputX(index);
    coordinates[offset * 2 + 1] = wasm.routerOutputY(index);
  }
  return coordinates;
}

function yieldWorker(): Promise<void> {
  return new Promise(resolve => globalThis.setTimeout(resolve, 0));
}

async function loadRouter(): Promise<RouterWasmExports> {
  exportsPromise ??= instantiateRouter();
  return exportsPromise;
}

async function instantiateRouter(): Promise<RouterWasmExports> {
  const wasmUrl = new URL("./path-router.wasm", import.meta.url);
  const response = await fetch(wasmUrl);
  if (!response.ok) {
    throw new Error(`Could not load the WebAssembly router (${response.status}).`);
  }
  const bytes = await response.arrayBuffer();
  const result = await WebAssembly.instantiate(bytes, {
    env: {
      abort: (_message: number, _filename: number, line: number, column: number): never => {
        throw new Error(`The WebAssembly router aborted at ${line}:${column}.`);
      }
    }
  });
  const exports = result.instance.exports as unknown as RouterWasmExports;
  if (exports.routerVersion() !== 2) {
    throw new Error("The WebAssembly router version is not supported.");
  }
  return exports;
}

function checkStatus(status: number, operation: string): void {
  if (status < 0) {
    throw new Error(`The WebAssembly router could not ${operation} (${status}).`);
  }
}
'''
write("src/webview/routerWorker.ts", worker)

client = r'''import {
  joinPathsByDrawingRoute,
  type RoutedPathResult,
  type RoutingPoint
} from "./pathRouter";

interface WorkerRouteRequest {
  readonly type: "route";
  readonly id: number;
  readonly coordinates: Float64Array;
  readonly offsets: Uint32Array;
  readonly outerRadius: number;
  readonly startFromOuterEdge: boolean;
}

interface WorkerRouteProgress {
  readonly type: "progress";
  readonly id: number;
  readonly coordinates: Float64Array;
  readonly completedPaths: number;
  readonly totalPaths: number;
}

interface WorkerRouteSuccess {
  readonly type: "routed";
  readonly id: number;
  readonly coordinates: Float64Array;
  readonly connectorCount: number;
  readonly newConnectorDistance: number;
  readonly crossingCount: number;
}

interface WorkerRouteFailure {
  readonly type: "error";
  readonly id: number;
  readonly message: string;
}

type WorkerRouteResponse = WorkerRouteProgress | WorkerRouteSuccess | WorkerRouteFailure;

export interface RoutingProgress {
  readonly completedPaths: number;
  readonly totalPaths: number;
  readonly percentage: number;
  readonly elapsedMs: number;
  readonly etaMs: number | undefined;
  readonly points: readonly RoutingPoint[];
}

export interface RoutedWorkerResult extends RoutedPathResult {
  readonly engine: "wasm" | "typescript";
}

interface PendingRoute {
  readonly resolve: (result: RoutedWorkerResult) => void;
  readonly reject: (error: Error) => void;
  readonly startedAt: number;
  readonly onProgress: ((progress: RoutingProgress) => void) | undefined;
}

let nextRequestId = 1;
let routerWorker: Worker | undefined;
let workerUnavailable = false;
const pendingRoutes = new Map<number, PendingRoute>();

export async function routePathsInWorker(
  paths: readonly (readonly RoutingPoint[])[],
  outerRadius: number,
  startFromOuterEdge: boolean,
  onProgress?: (progress: RoutingProgress) => void
): Promise<RoutedWorkerResult> {
  try {
    if (workerUnavailable) {
      throw new Error("The WebAssembly router worker is unavailable.");
    }
    return await requestWorkerRoute(paths, outerRadius, startFromOuterEdge, onProgress);
  } catch (error: unknown) {
    console.error(
      "The WebAssembly router failed; using the slower TypeScript fallback.",
      error
    );
    workerUnavailable = true;
    routerWorker?.terminate();
    routerWorker = undefined;
    const fallback = joinPathsByDrawingRoute(paths, outerRadius, startFromOuterEdge);
    return { ...fallback, engine: "typescript" };
  }
}

function requestWorkerRoute(
  paths: readonly (readonly RoutingPoint[])[],
  outerRadius: number,
  startFromOuterEdge: boolean,
  onProgress: ((progress: RoutingProgress) => void) | undefined
): Promise<RoutedWorkerResult> {
  const worker = ensureWorker();
  const offsets = new Uint32Array(paths.length + 1);
  let pointCount = 0;
  for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
    offsets[pathIndex] = pointCount;
    pointCount += paths[pathIndex]?.length ?? 0;
  }
  offsets[paths.length] = pointCount;

  const coordinates = new Float64Array(pointCount * 2);
  let coordinateIndex = 0;
  for (const path of paths) {
    for (const point of path) {
      coordinates[coordinateIndex++] = point.x;
      coordinates[coordinateIndex++] = point.y;
    }
  }

  const id = nextRequestId++;
  const request: WorkerRouteRequest = {
    type: "route",
    id,
    coordinates,
    offsets,
    outerRadius,
    startFromOuterEdge
  };

  return new Promise<RoutedWorkerResult>((resolve, reject) => {
    pendingRoutes.set(id, {
      resolve,
      reject,
      startedAt: performance.now(),
      onProgress
    });
    worker.postMessage(request, [coordinates.buffer, offsets.buffer]);
  });
}

function ensureWorker(): Worker {
  if (routerWorker !== undefined) {
    return routerWorker;
  }

  const worker = new Worker(new URL("./routerWorker.js", import.meta.url), {
    type: "module",
    name: "sandsara-path-router"
  });
  worker.addEventListener("message", handleWorkerMessage);
  worker.addEventListener("error", event => {
    const error = new Error(event.message || "The WebAssembly router worker failed.");
    rejectAll(error);
  });
  worker.addEventListener("messageerror", () => {
    rejectAll(new Error("The WebAssembly router returned an unreadable message."));
  });
  routerWorker = worker;
  return worker;
}

function handleWorkerMessage(event: MessageEvent<WorkerRouteResponse>): void {
  const response = event.data;
  const pending = pendingRoutes.get(response.id);
  if (pending === undefined) {
    return;
  }

  if (response.type === "progress") {
    const elapsedMs = Math.max(0, performance.now() - pending.startedAt);
    const totalPaths = Math.max(0, response.totalPaths);
    const completedPaths = Math.min(totalPaths, Math.max(0, response.completedPaths));
    const percentage = totalPaths === 0 ? 100 : completedPaths * 100 / totalPaths;
    const etaMs = completedPaths > 0 && completedPaths < totalPaths
      ? elapsedMs * (totalPaths - completedPaths) / completedPaths
      : undefined;
    pending.onProgress?.({
      completedPaths,
      totalPaths,
      percentage,
      elapsedMs,
      etaMs,
      points: pointsFromCoordinates(response.coordinates)
    });
    return;
  }

  pendingRoutes.delete(response.id);
  if (response.type === "error") {
    pending.reject(new Error(response.message));
    return;
  }

  pending.resolve({
    points: pointsFromCoordinates(response.coordinates),
    connectorCount: response.connectorCount,
    newConnectorDistance: response.newConnectorDistance,
    crossingCount: response.crossingCount,
    engine: "wasm"
  });
}

function pointsFromCoordinates(coordinates: Float64Array): RoutingPoint[] {
  const points: RoutingPoint[] = [];
  for (let index = 0; index + 1 < coordinates.length; index += 2) {
    points.push({
      x: coordinates[index] ?? 0,
      y: coordinates[index + 1] ?? 0
    });
  }
  return points;
}

function rejectAll(error: Error): void {
  for (const pending of pendingRoutes.values()) {
    pending.reject(error);
  }
  pendingRoutes.clear();
  workerUnavailable = true;
  routerWorker?.terminate();
  routerWorker = undefined;
}
'''
write("src/webview/routerWorkerClient.ts", client)

# Shared web/VS Code interface.
svg_path = "src/webview/svgToTrack.ts"
svg = read(svg_path)
svg = replace_once(
    svg,
    'import { routePathsInWorker } from "./routerWorkerClient";',
    'import { routePathsInWorker, type RoutingProgress } from "./routerWorkerClient";',
    "progress type import",
)
svg = replace_once(
    svg,
    '  .stats { color: var(--vscode-descriptionForeground); }\n  .notice { color: var(--vscode-editorWarning-foreground); }',
    '''  .stats { color: var(--vscode-descriptionForeground); }
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
  .route-progress-detail { color: var(--vscode-descriptionForeground); font-size: 0.9rem; }''',
    "route progress styles",
)
svg = replace_once(
    svg,
    '<label class="control-row"><input id="edgeEntry" type="checkbox" checked> Start and finish at the outer edge</label>',
    '<label class="control-row"><input id="edgeEntry" type="checkbox"> Start and finish at the outer edge</label>',
    "outer-edge checkbox default",
)
svg = replace_once(
    svg,
    '    <button id="save" disabled>Save Sandsara .bin…</button>\n    <div class="notice">',
    '''    <button id="save" disabled>Save Sandsara .bin…</button>
    <div id="routeProgress" class="route-progress" aria-live="polite" hidden>
      <div class="route-progress-heading"><strong id="routeProgressStage">Preparing route…</strong><span id="routeProgressPercent">0%</span></div>
      <progress id="routeProgressBar" max="100" value="0">0%</progress>
      <div id="routeProgressDetail" class="route-progress-detail">Waiting for the first traced path.</div>
    </div>
    <div class="notice">''',
    "route progress markup",
)
svg = replace_once(
    svg,
    'const stats = requiredElement<HTMLElement>("stats");\nconst svgMount = requiredElement<HTMLElement>("svgMount");',
    '''const stats = requiredElement<HTMLElement>("stats");
const routeProgress = requiredElement<HTMLElement>("routeProgress");
const routeProgressStage = requiredElement<HTMLElement>("routeProgressStage");
const routeProgressPercent = requiredElement<HTMLElement>("routeProgressPercent");
const routeProgressBar = requiredElement<HTMLProgressElement>("routeProgressBar");
const routeProgressDetail = requiredElement<HTMLElement>("routeProgressDetail");
const svgMount = requiredElement<HTMLElement>("svgMount");''',
    "route progress elements",
)
svg = replace_once(
    svg,
    'let mountedSvg: SVGSVGElement | undefined;',
    'let mountedSvg: SVGSVGElement | undefined;\nlet livePreviewPoints: Point[] = [];',
    "live preview state",
)
svg = replace_once(
    svg,
    '''new ResizeObserver(() => {
  if (latestTrack !== undefined) {
    drawTrack(latestTrack.points);
  }
}).observe(preview);''',
    '''new ResizeObserver(() => {
  if (latestTrack !== undefined) {
    drawTrack(latestTrack.points);
  } else if (livePreviewPoints.length > 0) {
    drawTrack(livePreviewPoints);
  }
}).observe(preview);''',
    "live preview resize",
)
svg = replace_once(
    svg,
    '''  latestTrack = undefined;
  saveButton.disabled = true;
  stats.removeAttribute("data-router-engine");''',
    '''  latestTrack = undefined;
  livePreviewPoints = [];
  saveButton.disabled = true;
  stats.removeAttribute("data-router-engine");
  beginRoutingProgress();''',
    "routing progress reset",
)
svg = replace_once(
    svg,
    '''    const ordered = await routePathsInWorker(
      fittedPaths,
      SANDSARA_RADIUS,
      edgeEntry.checked
    );''',
    '''    const ordered = await routePathsInWorker(
      fittedPaths,
      SANDSARA_RADIUS,
      edgeEntry.checked,
      progress => {
        if (requestSerial !== generationSerial) {
          return;
        }
        livePreviewPoints.push(...progress.points);
        if (livePreviewPoints.length > 0) {
          drawTrack(livePreviewPoints);
        }
        updateRoutingProgress(progress);
      }
    );''',
    "incremental route callback",
)
svg = replace_once(
    svg,
    '''    saveButton.disabled = false;
    drawTrack(integerPoints);

    const estimatedBytes''',
    '''    saveButton.disabled = false;
    livePreviewPoints = [...integerPoints];
    drawTrack(integerPoints);
    completeRoutingProgress(sampledPaths.length);

    const estimatedBytes''',
    "routing progress completion",
)
helpers = r'''
function beginRoutingProgress(): void {
  routeProgress.hidden = false;
  routeProgressStage.textContent = "Preparing radial route…";
  routeProgressPercent.textContent = "0%";
  routeProgressBar.value = 0;
  routeProgressBar.textContent = "0%";
  routeProgressDetail.textContent = "Waiting for the first traced path.";
}

function updateRoutingProgress(progress: RoutingProgress): void {
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

'''
svg = replace_once(svg, "function mountSafeSvg", helpers + "function mountSafeSvg", "routing progress helpers")
write(svg_path, svg)

# Mirror progress into the website's outer progress panel.
site_path = "src/site/generate.ts"
site = read(site_path)
site = replace_once(
    site,
    'savePreview.addEventListener("click", () => void downloadPreviewImage());',
    '''savePreview.addEventListener("click", () => void downloadPreviewImage());
window.addEventListener("sandsara-routing-progress", event => {
  const detail = (event as CustomEvent<{
    readonly completedPaths: number;
    readonly totalPaths: number;
    readonly percentage: number;
    readonly etaText: string;
  }>).detail;
  if (detail === undefined) {
    return;
  }
  progressPanel.hidden = false;
  progressPanel.classList.remove("complete", "error");
  progressStage.textContent =
    `Tracing path ${detail.completedPaths.toLocaleString("en-GB")} of ${detail.totalPaths.toLocaleString("en-GB")}`;
  progressBar.value = detail.percentage;
  progressBar.textContent = `${detail.percentage}%`;
  progressDetail.textContent = detail.etaText;
});''',
    "website routing progress listener",
)
write(site_path, site)

# Release metadata and documentation.
package_path = "package.json"
package = json.loads(read(package_path))
package["version"] = "0.3.2"
write(package_path, json.dumps(package, indent=2) + "\n")

readme_path = "README.md"
readme = read(readme_path)
readme = replace_once(
    readme,
    "Both deployments therefore execute the same route planner through a Web Worker.",
    "Both deployments therefore execute the same route planner through a Web Worker. The router advances one radial path at a time and streams each completed coordinate chunk back to the interface, so the preview grows live while a real path-count progress bar and elapsed-time ETA update in both the website and Visual Studio Code.",
    "README worker description",
)
write(readme_path, readme)

changelog_path = "CHANGELOG.md"
changelog = read(changelog_path)
release = """## 0.3.2 - 2026-07-26

- streams completed radial paths from the WebAssembly worker while routing continues
- draws the calculated route live in both the website and Visual Studio Code
- adds a real path-count progress bar with an elapsed-time ETA estimate
- leaves outer-edge start and finish routing available but disabled by default

"""
if "## 0.3.2" not in changelog:
    changelog = release + changelog
write(changelog_path, changelog)
