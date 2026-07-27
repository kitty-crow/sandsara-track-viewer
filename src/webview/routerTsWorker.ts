import {
  joinPth,
  type PthProg,
  type Pt
} from "./pathRouter";

interface WorkReq {
  readonly type: "route";
  readonly id: number;
  readonly coordinates: Float64Array;
  readonly offsets: Uint32Array;
  readonly outerRadius: number;
  readonly startFromOuterEdge: boolean;
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
  readonly restored: false;
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

const host = globalThis as unknown as WorkerHost;

host.addEventListener("message", event => {
  if (event.data.type === "route") {
    route(event.data);
  }
});

function route(request: WorkReq): void {
  try {
    const paths = readPaths(request.coordinates, request.offsets);
    let sentPointCount = 0;
    const result = joinPth(
      paths,
      request.outerRadius,
      request.startFromOuterEdge,
      progress => {
        sentPointCount = postProgress(request.id, progress, sentPointCount);
      }
    );
    const coordinates = writePoints(result.points);
    const response: WorkDone = {
      type: "routed",
      id: request.id,
      coordinates,
      connectorCount: result.connectorCount,
      newConnectorDistance: result.newConnectorDistance,
      crossingCount: result.crossingCount
    };
    host.postMessage(response, [coordinates.buffer]);
  } catch (error: unknown) {
    const response: WorkErr = {
      type: "error",
      id: request.id,
      message: error instanceof Error ? error.message : String(error)
    };
    host.postMessage(response);
  }
}

function postProgress(
  id: number,
  progress: PthProg,
  previousPointCount: number
): number {
  const points = progress.points.slice(previousPointCount);
  const coordinates = writePoints(points);
  const response: WorkProg = {
    type: "progress",
    id,
    coordinates,
    completedPaths: progress.completedPaths,
    totalPaths: progress.totalPaths,
    connectorCount: progress.connectorCount,
    newConnectorDistance: progress.newConnectorDistance,
    crossingCount: progress.crossingCount,
    restored: false
  };
  host.postMessage(response, [coordinates.buffer]);
  return progress.points.length;
}

function readPaths(
  coordinates: Float64Array,
  offsets: Uint32Array
): Pt[][] {
  const paths: Pt[][] = [];
  for (let pathIndex = 0; pathIndex + 1 < offsets.length; pathIndex++) {
    const start = offsets[pathIndex] ?? 0;
    const end = offsets[pathIndex + 1] ?? start;
    const path: Pt[] = [];
    for (let pointIndex = start; pointIndex < end; pointIndex++) {
      path.push({
        x: coordinates[pointIndex * 2] ?? 0,
        y: coordinates[pointIndex * 2 + 1] ?? 0
      });
    }
    paths.push(path);
  }
  return paths;
}

function writePoints(points: readonly Pt[]): Float64Array {
  const coordinates = new Float64Array(points.length * 2);
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (point !== undefined) {
      coordinates[index * 2] = point.x;
      coordinates[index * 2 + 1] = point.y;
    }
  }
  return coordinates;
}
