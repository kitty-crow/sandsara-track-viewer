import {
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
