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
  readonly routerRun: () => number;
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

interface WorkerHost {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<WorkerRouteRequest>) => void
  ): void;
  postMessage(message: WorkerRouteSuccess | WorkerRouteFailure, transfer?: Transferable[]): void;
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

    const runResult = wasm.routerRun();
    if (runResult < 0) {
      throw new Error(`The WebAssembly router stopped with code ${runResult}.`);
    }
    const outputCount = wasm.routerOutputCount();
    const coordinates = new Float64Array(outputCount * 2);
    for (let index = 0; index < outputCount; index++) {
      coordinates[index * 2] = wasm.routerOutputX(index);
      coordinates[index * 2 + 1] = wasm.routerOutputY(index);
    }

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
  if (exports.routerVersion() !== 1) {
    throw new Error("The WebAssembly router version is not supported.");
  }
  return exports;
}

function checkStatus(status: number, operation: string): void {
  if (status < 0) {
    throw new Error(`The WebAssembly router could not ${operation} (${status}).`);
  }
}
