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

export interface RoutingProgress {
  readonly completedPaths: number;
  readonly totalPaths: number;
  readonly percentage: number;
  readonly elapsedMs: number;
  readonly etaMs: number | undefined;
  readonly points: readonly RoutingPoint[];
  readonly restored: boolean;
}

export interface RoutedWorkerResult extends RoutedPathResult {
  readonly engine: "wasm" | "typescript";
}

interface StoredRouteCheckpoint {
  readonly key: string;
  readonly version: 1;
  readonly completedPaths: number;
  readonly totalPaths: number;
  readonly coordinates: ArrayBuffer;
  readonly chunkOffsets: ArrayBuffer;
  readonly connectorCount: number;
  readonly newConnectorDistance: number;
  readonly crossingCount: number;
  readonly updatedAt: number;
}

interface PendingRoute {
  readonly resolve: (result: RoutedWorkerResult) => void;
  readonly reject: (error: Error) => void;
  readonly startedAt: number;
  readonly onProgress: ((progress: RoutingProgress) => void) | undefined;
  readonly checkpointKey: string;
  readonly chunks: Float64Array[];
  completedPaths: number;
  totalPaths: number;
  connectorCount: number;
  newConnectorDistance: number;
  crossingCount: number;
}

const CHECKPOINT_DATABASE = "sandsara-track-viewer";
const CHECKPOINT_STORE = "route-checkpoints";
const CHECKPOINT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
let nextRequestId = 1;
let routerWorker: Worker | undefined;
let workerUnavailable = false;
let checkpointDatabasePromise: Promise<IDBDatabase> | undefined;
let checkpointWriteQueue: Promise<void> = Promise.resolve();
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
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
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

export function cancelActiveRouting(): void {
  const error = new DOMException("Routing was superseded by new settings.", "AbortError");
  for (const pending of pendingRoutes.values()) {
    pending.reject(error);
  }
  pendingRoutes.clear();
  routerWorker?.terminate();
  routerWorker = undefined;
  workerUnavailable = false;
}

async function requestWorkerRoute(
  paths: readonly (readonly RoutingPoint[])[],
  outerRadius: number,
  startFromOuterEdge: boolean,
  onProgress: ((progress: RoutingProgress) => void) | undefined
): Promise<RoutedWorkerResult> {
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

  const checkpointKey = routeCheckpointKey(
    coordinates,
    offsets,
    outerRadius,
    startFromOuterEdge
  );
  const checkpoint = await loadCheckpoint(checkpointKey);
  const chunks = checkpoint === undefined ? [] : chunksFromCheckpoint(checkpoint);
  const resumeCoordinates = checkpoint === undefined
    ? new Float64Array()
    : new Float64Array(checkpoint.coordinates.slice(0));
  const resumeChunkOffsets = checkpoint === undefined
    ? new Uint32Array()
    : new Uint32Array(checkpoint.chunkOffsets.slice(0));

  const id = nextRequestId++;
  const request: WorkerRouteRequest = {
    type: "route",
    id,
    coordinates,
    offsets,
    outerRadius,
    startFromOuterEdge,
    resumeCoordinates,
    resumeChunkOffsets,
    resumeCompletedPaths: checkpoint?.completedPaths ?? 0,
    resumeConnectorCount: checkpoint?.connectorCount ?? 0,
    resumeNewConnectorDistance: checkpoint?.newConnectorDistance ?? 0,
    resumeCrossingCount: checkpoint?.crossingCount ?? 0
  };
  const worker = ensureWorker();

  return new Promise<RoutedWorkerResult>((resolve, reject) => {
    pendingRoutes.set(id, {
      resolve,
      reject,
      startedAt: performance.now(),
      onProgress,
      checkpointKey,
      chunks,
      completedPaths: checkpoint?.completedPaths ?? 0,
      totalPaths: checkpoint?.totalPaths ?? paths.length,
      connectorCount: checkpoint?.connectorCount ?? 0,
      newConnectorDistance: checkpoint?.newConnectorDistance ?? 0,
      crossingCount: checkpoint?.crossingCount ?? 0
    });
    worker.postMessage(request, [
      coordinates.buffer,
      offsets.buffer,
      resumeCoordinates.buffer,
      resumeChunkOffsets.buffer
    ]);
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
    rejectAll(new Error(event.message || "The WebAssembly router worker failed."), true);
  });
  worker.addEventListener("messageerror", () => {
    rejectAll(new Error("The WebAssembly router returned an unreadable message."), true);
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
    if (!response.restored && response.coordinates.length > 0) {
      pending.chunks.push(response.coordinates.slice());
      pending.completedPaths = completedPaths;
      pending.totalPaths = totalPaths;
      pending.connectorCount = response.connectorCount;
      pending.newConnectorDistance = response.newConnectorDistance;
      pending.crossingCount = response.crossingCount;
      queueCheckpointSave(pending);
    }
    pending.onProgress?.({
      completedPaths,
      totalPaths,
      percentage,
      elapsedMs,
      etaMs,
      points: pointsFromCoordinates(response.coordinates),
      restored: response.restored
    });
    return;
  }

  pendingRoutes.delete(response.id);
  if (response.type === "error") {
    pending.reject(new Error(response.message));
    return;
  }

  queueCheckpointDelete(pending.checkpointKey);
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

function rejectAll(error: Error, unavailable: boolean): void {
  for (const pending of pendingRoutes.values()) {
    pending.reject(error);
  }
  pendingRoutes.clear();
  workerUnavailable = unavailable;
  routerWorker?.terminate();
  routerWorker = undefined;
}

function routeCheckpointKey(
  coordinates: Float64Array,
  offsets: Uint32Array,
  outerRadius: number,
  startFromOuterEdge: boolean
): string {
  let hash = 2166136261;
  const mix = (value: number): void => {
    hash ^= value >>> 0;
    hash = Math.imul(hash, 16777619);
  };
  const coordinateWords = new Uint32Array(
    coordinates.buffer,
    coordinates.byteOffset,
    Math.floor(coordinates.byteLength / 4)
  );
  for (const word of coordinateWords) mix(word);
  for (const offset of offsets) mix(offset);
  const radius = new Float64Array([outerRadius]);
  const radiusWords = new Uint32Array(radius.buffer);
  mix(radiusWords[0] ?? 0);
  mix(radiusWords[1] ?? 0);
  mix(startFromOuterEdge ? 1 : 0);
  mix(3);
  return `router-v3-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function chunksFromCheckpoint(checkpoint: StoredRouteCheckpoint): Float64Array[] {
  const coordinates = new Float64Array(checkpoint.coordinates);
  const offsets = new Uint32Array(checkpoint.chunkOffsets);
  const chunks: Float64Array[] = [];
  for (let index = 0; index + 1 < offsets.length; index++) {
    const start = (offsets[index] ?? 0) * 2;
    const end = (offsets[index + 1] ?? 0) * 2;
    chunks.push(coordinates.slice(start, end));
  }
  return chunks;
}

function queueCheckpointSave(pending: PendingRoute): void {
  const checkpoint = checkpointFromPending(pending);
  checkpointWriteQueue = checkpointWriteQueue
    .catch(() => undefined)
    .then(() => putCheckpoint(checkpoint))
    .catch(error => console.warn("Could not save routing progress.", error));
}

function queueCheckpointDelete(key: string): void {
  checkpointWriteQueue = checkpointWriteQueue
    .catch(() => undefined)
    .then(() => deleteCheckpoint(key))
    .catch(error => console.warn("Could not clear routing progress.", error));
}

function checkpointFromPending(pending: PendingRoute): StoredRouteCheckpoint {
  let coordinateCount = 0;
  for (const chunk of pending.chunks) coordinateCount += chunk.length;
  const coordinates = new Float64Array(coordinateCount);
  const offsets = new Uint32Array(pending.chunks.length + 1);
  let coordinateOffset = 0;
  for (let index = 0; index < pending.chunks.length; index++) {
    offsets[index] = coordinateOffset / 2;
    const chunk = pending.chunks[index];
    if (chunk !== undefined) {
      coordinates.set(chunk, coordinateOffset);
      coordinateOffset += chunk.length;
    }
  }
  offsets[pending.chunks.length] = coordinateOffset / 2;
  return {
    key: pending.checkpointKey,
    version: 1,
    completedPaths: pending.completedPaths,
    totalPaths: pending.totalPaths,
    coordinates: coordinates.buffer,
    chunkOffsets: offsets.buffer,
    connectorCount: pending.connectorCount,
    newConnectorDistance: pending.newConnectorDistance,
    crossingCount: pending.crossingCount,
    updatedAt: Date.now()
  };
}

async function loadCheckpoint(key: string): Promise<StoredRouteCheckpoint | undefined> {
  try {
    const database = await checkpointDatabase();
    const checkpoint = await new Promise<StoredRouteCheckpoint | undefined>((resolve, reject) => {
      const request = database.transaction(CHECKPOINT_STORE, "readonly")
        .objectStore(CHECKPOINT_STORE)
        .get(key);
      request.onsuccess = () => resolve(request.result as StoredRouteCheckpoint | undefined);
      request.onerror = () => reject(request.error ?? new Error("Checkpoint read failed."));
    });
    if (checkpoint !== undefined && Date.now() - checkpoint.updatedAt > CHECKPOINT_MAX_AGE_MS) {
      await deleteCheckpoint(key);
      return undefined;
    }
    return checkpoint;
  } catch (error: unknown) {
    console.warn("Could not restore routing progress.", error);
    return undefined;
  }
}

async function putCheckpoint(checkpoint: StoredRouteCheckpoint): Promise<void> {
  const database = await checkpointDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(CHECKPOINT_STORE, "readwrite");
    transaction.objectStore(CHECKPOINT_STORE).put(checkpoint);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Checkpoint write failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Checkpoint write was aborted."));
  });
}

async function deleteCheckpoint(key: string): Promise<void> {
  const database = await checkpointDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(CHECKPOINT_STORE, "readwrite");
    transaction.objectStore(CHECKPOINT_STORE).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Checkpoint deletion failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Checkpoint deletion was aborted."));
  });
}

function checkpointDatabase(): Promise<IDBDatabase> {
  checkpointDatabasePromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(CHECKPOINT_DATABASE, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CHECKPOINT_STORE)) {
        database.createObjectStore(CHECKPOINT_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Checkpoint database could not open."));
  });
  return checkpointDatabasePromise;
}
