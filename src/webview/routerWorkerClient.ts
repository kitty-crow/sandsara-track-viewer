import type {
  PthRes,
  Pt
} from "./pathRouter";

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

export interface RouteProg {
  readonly completedPaths: number;
  readonly totalPaths: number;
  readonly percentage: number;
  readonly elapsedMs: number;
  readonly etaMs: number | undefined;
  readonly points: readonly Pt[];
  readonly restored: boolean;
}

export interface RouteRes extends PthRes {
  readonly engine: "wasm";
}

interface SavedRoute {
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

interface Pending {
  readonly resolve: (result: RouteRes) => void;
  readonly reject: (error: Error) => void;
  readonly startedAt: number;
  readonly onProgress: ((progress: RouteProg) => void) | undefined;
  readonly checkpointKey: string;
  readonly chunks: Float64Array[];
  completedPaths: number;
  totalPaths: number;
  connectorCount: number;
  newConnectorDistance: number;
  crossingCount: number;
}

interface WorkerBundle {
  readonly worker: Worker;
  readonly blobUrl: string;
}

const DB_NAME = "sandsara-track-viewer";
const DB_STORE = "route-checkpoints";
const DB_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
let nextId = 1;
let routeWorker: Worker | undefined;
let workerBlobUrl: string | undefined;
let workerP: Promise<WorkerBundle> | undefined;
let workerLoadId = 0;
let workerBad = false;
let dbP: Promise<IDBDatabase> | undefined;
let writeQ: Promise<void> = Promise.resolve();
const pendingMap = new Map<number, Pending>();

export async function routePth(
  paths: readonly (readonly Pt[])[],
  outerRadius: number,
  startFromOuterEdge: boolean,
  onProgress?: (progress: RouteProg) => void
): Promise<RouteRes> {
  try {
    if (workerBad) {
      throw new Error("The WebAssembly router worker is unavailable.");
    }
    return await askWorker(paths, outerRadius, startFromOuterEdge, onProgress);
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    console.error("The WebAssembly router failed.", error);
    workerBad = true;
    stopWorker();
    throw new Error(`The WebAssembly router failed: ${errMsg(error)}`);
  }
}

export function cancelRoute(): void {
  const error = new DOMException("Routing was superseded by new settings.", "AbortError");
  for (const pending of pendingMap.values()) {
    pending.reject(error);
  }
  pendingMap.clear();
  stopWorker();
  workerBad = false;
}

async function askWorker(
  paths: readonly (readonly Pt[])[],
  outerRadius: number,
  startFromOuterEdge: boolean,
  onProgress: ((progress: RouteProg) => void) | undefined
): Promise<RouteRes> {
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

  const checkpointKey = routeKey(
    coordinates,
    offsets,
    outerRadius,
    startFromOuterEdge
  );
  const checkpoint = await loadSaved(checkpointKey);
  const chunks = checkpoint === undefined ? [] : savedChunks(checkpoint);
  const resumeCoordinates = checkpoint === undefined
    ? new Float64Array()
    : new Float64Array(checkpoint.coordinates.slice(0));
  const resumeChunkOffsets = checkpoint === undefined
    ? new Uint32Array()
    : new Uint32Array(checkpoint.chunkOffsets.slice(0));

  const id = nextId++;
  const request: WorkReq = {
    type: "route",
    id,
    wasmUrl: new URL("./path-router.wasm", import.meta.url).href,
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
  const worker = await getWorker();

  return new Promise<RouteRes>((resolve, reject) => {
    pendingMap.set(id, {
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

async function getWorker(): Promise<Worker> {
  if (routeWorker !== undefined) {
    return routeWorker;
  }

  const loadId = workerLoadId;
  const loading = workerP ??= makeWorker();
  let bundle: WorkerBundle;
  try {
    bundle = await loading;
  } finally {
    if (workerP === loading) {
      workerP = undefined;
    }
  }

  if (loadId !== workerLoadId) {
    bundle.worker.terminate();
    URL.revokeObjectURL(bundle.blobUrl);
    throw new DOMException("Routing was superseded by new settings.", "AbortError");
  }

  routeWorker = bundle.worker;
  workerBlobUrl = bundle.blobUrl;
  return routeWorker;
}

async function makeWorker(): Promise<WorkerBundle> {
  const sourceUrl = new URL("./routerWorker.js", import.meta.url);
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Could not load the router worker (${response.status}).`);
  }

  const source = await response.text();
  const blobUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    const worker = new Worker(blobUrl, {
      type: "module",
      name: "sandsara-path-router"
    });
    worker.addEventListener("message", onWorkerMsg);
    worker.addEventListener("error", event => {
      rejectAll(new Error(event.message || "The WebAssembly router worker failed."), true);
    });
    worker.addEventListener("messageerror", () => {
      rejectAll(new Error("The WebAssembly router returned an unreadable message."), true);
    });
    return { worker, blobUrl };
  } catch (error: unknown) {
    URL.revokeObjectURL(blobUrl);
    throw error;
  }
}

function stopWorker(): void {
  workerLoadId++;
  workerP = undefined;
  routeWorker?.terminate();
  routeWorker = undefined;
  if (workerBlobUrl !== undefined) {
    URL.revokeObjectURL(workerBlobUrl);
    workerBlobUrl = undefined;
  }
}

function onWorkerMsg(event: MessageEvent<WorkMsg>): void {
  const response = event.data;
  const pending = pendingMap.get(response.id);
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
      saveLater(pending);
    }
    pending.onProgress?.({
      completedPaths,
      totalPaths,
      percentage,
      elapsedMs,
      etaMs,
      points: ptsFromCoords(response.coordinates),
      restored: response.restored
    });
    return;
  }

  pendingMap.delete(response.id);
  if (response.type === "error") {
    pending.reject(new Error(response.message));
    return;
  }

  dropLater(pending.checkpointKey);
  pending.resolve({
    points: ptsFromCoords(response.coordinates),
    connectorCount: response.connectorCount,
    newConnectorDistance: response.newConnectorDistance,
    crossingCount: response.crossingCount,
    engine: "wasm"
  });
}

function ptsFromCoords(coordinates: Float64Array): Pt[] {
  const points: Pt[] = [];
  for (let index = 0; index + 1 < coordinates.length; index += 2) {
    points.push({
      x: coordinates[index] ?? 0,
      y: coordinates[index + 1] ?? 0
    });
  }
  return points;
}

function rejectAll(error: Error, unavailable: boolean): void {
  for (const pending of pendingMap.values()) {
    pending.reject(error);
  }
  pendingMap.clear();
  workerBad = unavailable;
  stopWorker();
}

function routeKey(
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
  mix(4);
  return `router-v4-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function savedChunks(checkpoint: SavedRoute): Float64Array[] {
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

function saveLater(pending: Pending): void {
  const checkpoint = makeSaved(pending);
  writeQ = writeQ
    .catch(() => undefined)
    .then(() => putSaved(checkpoint))
    .catch(error => console.warn("Could not save routing progress.", error));
}

function dropLater(key: string): void {
  writeQ = writeQ
    .catch(() => undefined)
    .then(() => dropSaved(key))
    .catch(error => console.warn("Could not clear routing progress.", error));
}

function makeSaved(pending: Pending): SavedRoute {
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

async function loadSaved(key: string): Promise<SavedRoute | undefined> {
  try {
    const database = await routeDb();
    const checkpoint = await new Promise<SavedRoute | undefined>((resolve, reject) => {
      const request = database.transaction(DB_STORE, "readonly")
        .objectStore(DB_STORE)
        .get(key);
      request.onsuccess = () => resolve(request.result as SavedRoute | undefined);
      request.onerror = () => reject(request.error ?? new Error("Checkpoint read failed."));
    });
    if (checkpoint !== undefined && Date.now() - checkpoint.updatedAt > DB_MAX_AGE) {
      await dropSaved(key);
      return undefined;
    }
    return checkpoint;
  } catch (error: unknown) {
    console.warn("Could not restore routing progress.", error);
    return undefined;
  }
}

async function putSaved(checkpoint: SavedRoute): Promise<void> {
  const database = await routeDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(DB_STORE, "readwrite");
    transaction.objectStore(DB_STORE).put(checkpoint);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Checkpoint write failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Checkpoint write was aborted."));
  });
}

async function dropSaved(key: string): Promise<void> {
  const database = await routeDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(DB_STORE, "readwrite");
    transaction.objectStore(DB_STORE).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Checkpoint deletion failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Checkpoint deletion was aborted."));
  });
}

function routeDb(): Promise<IDBDatabase> {
  dbP ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DB_STORE)) {
        database.createObjectStore(DB_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Checkpoint database could not open."));
  });
  return dbP;
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
