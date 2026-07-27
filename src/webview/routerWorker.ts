interface RouterWasmExports {
  readonly rVer: () => number;
  readonly rCfg: (
    pathCount: number,
    pointCount: number,
    outerRadius: number,
    startFromOuterEdge: number
  ) => number;
  readonly rSetPth: (pathIndex: number, start: number, length: number) => number;
  readonly rSetPt: (pointIndex: number, x: number, y: number) => number;
  readonly rBegin: () => number;
  readonly rResume: (
    completedPaths: number,
    connectorCount: number,
    newConnectorDistance: number,
    crossingCount: number
  ) => number;
  readonly rChunk: () => number;
  readonly rPt: (x: number, y: number) => number;
  readonly rChunkEnd: () => number;
  readonly rStep: () => number;
  readonly rDone: () => number;
  readonly rDoneCnt: () => number;
  readonly rTotal: () => number;
  readonly rOutCnt: () => number;
  readonly rOutX: (index: number) => number;
  readonly rOutY: (index: number) => number;
  readonly rJoinCnt: () => number;
  readonly rNewLen: () => number;
  readonly rCrossCnt: () => number;
}

interface WorkReq {
  readonly type: "route";
  readonly id: number;
  readonly wasmUrl: string;
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

interface WorkProg {
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

interface WorkDone {
  readonly type: "routed";
  readonly id: number;
  readonly coordinates: Float64Array;
  readonly connectorCount: number;
  readonly newConnectorDistance: number;
  readonly crossingCount: number;
}

interface WorkErr {
  readonly type: "error";
  readonly id: number;
  readonly message: string;
}

type WorkMsg = WorkProg | WorkDone | WorkErr;

interface WorkerHost {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<WorkReq>) => void
  ): void;
  postMessage(message: WorkMsg, transfer?: Transferable[]): void;
}

const workerHost = globalThis as unknown as WorkerHost;
let exportsPromise: Promise<RouterWasmExports> | undefined;

workerHost.addEventListener("message", event => {
  if (event.data.type === "route") {
    void route(event.data);
  }
});

async function route(request: WorkReq): Promise<void> {
  try {
    const wasm = await loadRouter(request.wasmUrl);
    const pathCount = request.offsets.length - 1;
    const pointCount = Math.floor(request.coordinates.length / 2);
    checkStatus(wasm.rCfg(
      pathCount,
      pointCount,
      request.outerRadius,
      request.startFromOuterEdge ? 1 : 0
    ), "configure");

    for (let pathIndex = 0; pathIndex < pathCount; pathIndex++) {
      const start = request.offsets[pathIndex] ?? 0;
      const end = request.offsets[pathIndex + 1] ?? start;
      checkStatus(wasm.rSetPth(pathIndex, start, end - start), "set path");
    }

    for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
      checkStatus(wasm.rSetPt(
        pointIndex,
        request.coordinates[pointIndex * 2] ?? 0,
        request.coordinates[pointIndex * 2 + 1] ?? 0
      ), "set point");
    }

    checkStatus(wasm.rBegin(), "begin routing");
    let sentOutputCount = 0;

    if (request.resumeCompletedPaths > 0 && request.resumeChunkOffsets.length > 1) {
      checkStatus(wasm.rResume(
        request.resumeCompletedPaths,
        request.resumeConnectorCount,
        request.resumeNewConnectorDistance,
        request.resumeCrossingCount
      ), "restore routing progress");
      restoreChunks(wasm, request.resumeCoordinates, request.resumeChunkOffsets);
      sentOutputCount = postProgress(wasm, request.id, 0, true);
    }

    while (wasm.rDone() === 0) {
      await yieldWorker();
      checkStatus(wasm.rStep(), "trace the next path");
      sentOutputCount = postProgress(wasm, request.id, sentOutputCount, false);
    }

    const outputCount = wasm.rOutCnt();
    const coordinates = readCoordinates(wasm, 0, outputCount);
    const response: WorkDone = {
      type: "routed",
      id: request.id,
      coordinates,
      connectorCount: wasm.rJoinCnt(),
      newConnectorDistance: wasm.rNewLen(),
      crossingCount: wasm.rCrossCnt()
    };
    workerHost.postMessage(response, [coordinates.buffer]);
  } catch (error: unknown) {
    const response: WorkErr = {
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
    checkStatus(wasm.rChunk(), "begin restored path");
    for (let pointIndex = startPoint; pointIndex < endPoint; pointIndex++) {
      checkStatus(wasm.rPt(
        coordinates[pointIndex * 2] ?? 0,
        coordinates[pointIndex * 2 + 1] ?? 0
      ), "restore path point");
    }
    checkStatus(wasm.rChunkEnd(), "finish restored path");
  }
}

function postProgress(
  wasm: RouterWasmExports,
  id: number,
  previousCount: number,
  restored: boolean
): number {
  const outputCount = wasm.rOutCnt();
  const coordinates = readCoordinates(wasm, previousCount, outputCount);
  const response: WorkProg = {
    type: "progress",
    id,
    coordinates,
    completedPaths: wasm.rDoneCnt(),
    totalPaths: wasm.rTotal(),
    connectorCount: wasm.rJoinCnt(),
    newConnectorDistance: wasm.rNewLen(),
    crossingCount: wasm.rCrossCnt(),
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
    coordinates[offset * 2] = wasm.rOutX(index);
    coordinates[offset * 2 + 1] = wasm.rOutY(index);
  }
  return coordinates;
}

function yieldWorker(): Promise<void> {
  return new Promise(resolve => globalThis.setTimeout(resolve, 0));
}

async function loadRouter(wasmUrl: string): Promise<RouterWasmExports> {
  exportsPromise ??= instantiateRouter(wasmUrl);
  return exportsPromise;
}

async function instantiateRouter(wasmUrl: string): Promise<RouterWasmExports> {
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
  if (exports.rVer() !== 4) {
    throw new Error("The WebAssembly router version is not supported.");
  }
  return exports;
}

function checkStatus(status: number, operation: string): void {
  if (status < 0) {
    throw new Error(`The WebAssembly router could not ${operation} (${status}).`);
  }
}
