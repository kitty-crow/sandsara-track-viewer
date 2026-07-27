import { orientRouteFromAndBackToOuterEdge } from "./outerEdgeRouting";
import type { RoutingPoint } from "./routingGeometry";

interface RouterWasmExports {
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
  readonly routerResumeBegin: (
    completedPaths: number,
    connectorCount: number,
    newConnectorDistance: number,
    crossingCount: number
  ) => number;
  readonly routerResumeChunkBegin: () => number;
  readonly routerResumePoint: (x: number, y: number) => number;
  readonly routerResumeChunkEnd: () => number;
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
  readonly resumeCoordinates: Float64Array;
  readonly resumeChunkOffsets: Uint32Array;
  readonly resumeCompletedPaths: number;
  readonly resumeConnectorCount: number;
  readonly resumeNewConnectorDistance: number;
  readonly resumeCrossingCount: number;
}

interface WorkerRouteProgress {
  readonly type: "progress";
  readonly id: number;
  readonly coordinates: Float64Array;
  readonly completedPaths: number;
  readonly totalPaths: number;
  readonly connectorCount: number;
  readonly newConnectorDistance: number;
  readonly crossingCount: number;
  readonly restored: boolean;
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

    // The numerical router always calculates the canonical inner-to-outer walk.
    // Outer-ring mode is then produced by reversing that completed route and
    // finding a safe graph retrace back to its exact perimeter start.
    checkStatus(wasm.routerConfigure(
      pathCount,
      pointCount,
      request.outerRadius,
      0
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
    let sentOutputCount = 0;

    if (request.resumeCompletedPaths > 0 && request.resumeChunkOffsets.length > 1) {
      checkStatus(wasm.routerResumeBegin(
        request.resumeCompletedPaths,
        request.resumeConnectorCount,
        request.resumeNewConnectorDistance,
        request.resumeCrossingCount
      ), "restore routing progress");
      restoreChunks(wasm, request.resumeCoordinates, request.resumeChunkOffsets);
      sentOutputCount = postProgress(wasm, request.id, 0, true);
    }

    while (wasm.routerIsComplete() === 0) {
      await yieldWorker();
      checkStatus(wasm.routerStep(), "trace the next path");
      sentOutputCount = postProgress(wasm, request.id, sentOutputCount, false);
    }

    const outputCount = wasm.routerOutputCount();
    const rawCoordinates = readCoordinates(wasm, 0, outputCount);
    const rawPoints = pointsFromCoordinates(rawCoordinates);
    const oriented = request.startFromOuterEdge
      ? orientRouteFromAndBackToOuterEdge(rawPoints, request.outerRadius)
      : {
          points: rawPoints,
          connectorCount: 0,
          newConnectorDistance: 0
        };
    const coordinates = coordinatesFromPoints(oriented.points);
    const response: WorkerRouteSuccess = {
      type: "routed",
      id: request.id,
      coordinates,
      connectorCount: wasm.routerConnectorCount() + oriented.connectorCount,
      newConnectorDistance:
        wasm.routerNewConnectorDistance() + oriented.newConnectorDistance,
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

function restoreChunks(
  wasm: RouterWasmExports,
  coordinates: Float64Array,
  offsets: Uint32Array
): void {
  const chunkCount = Math.max(0, offsets.length - 1);
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
    const startPoint = offsets[chunkIndex] ?? 0;
    const endPoint = offsets[chunkIndex + 1] ?? startPoint;
    checkStatus(wasm.routerResumeChunkBegin(), "begin restored path");
    for (let pointIndex = startPoint; pointIndex < endPoint; pointIndex++) {
      checkStatus(wasm.routerResumePoint(
        coordinates[pointIndex * 2] ?? 0,
        coordinates[pointIndex * 2 + 1] ?? 0
      ), "restore path point");
    }
    checkStatus(wasm.routerResumeChunkEnd(), "finish restored path");
  }
}

function postProgress(
  wasm: RouterWasmExports,
  id: number,
  previousCount: number,
  restored: boolean
): number {
  const outputCount = wasm.routerOutputCount();
  const coordinates = readCoordinates(wasm, previousCount, outputCount);
  const response: WorkerRouteProgress = {
    type: "progress",
    id,
    coordinates,
    completedPaths: wasm.routerCompletedPathCount(),
    totalPaths: wasm.routerTotalPathCount(),
    connectorCount: wasm.routerConnectorCount(),
    newConnectorDistance: wasm.routerNewConnectorDistance(),
    crossingCount: wasm.routerCrossingCount(),
    restored
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

function coordinatesFromPoints(points: readonly RoutingPoint[]): Float64Array {
  const coordinates = new Float64Array(points.length * 2);
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    coordinates[index * 2] = point?.x ?? 0;
    coordinates[index * 2 + 1] = point?.y ?? 0;
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
  if (exports.routerVersion() !== 3) {
    throw new Error("The WebAssembly router version is not supported.");
  }
  return exports;
}

function checkStatus(status: number, operation: string): void {
  if (status < 0) {
    throw new Error(`The WebAssembly router could not ${operation} (${status}).`);
  }
}
