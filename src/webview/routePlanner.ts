import { pathRadialProfile } from "./radialRouting";
import { RouteGraph, type ShortestPaths } from "./routeGraph";
import {
  distance,
  EPSILON_SQUARED,
  pointOnOuterEdge,
  pointRadius,
  routingIndexes,
  segmentExposure,
  segmentsCrossAwayFromEndpoints,
  shortestAngleDelta,
  squaredDistance,
  type RoutingPoint
} from "./routingGeometry";

export interface RouteOption {
  readonly pathIndex: number;
  readonly entryIndex: number;
  readonly anchorNode: number;
  readonly mode: "direct" | "outer";
  readonly usedDistance: number;
  readonly newDistance: number;
  readonly newExposure: number;
  readonly edgeDistance: number;
  readonly crossings: number;
  readonly radialBacktrack: number;
  readonly radialAdvance: number;
}

interface IndexedSegment {
  readonly id: number;
  readonly pathIndex: number;
  readonly start: RoutingPoint;
  readonly end: RoutingPoint;
}

const MAX_PATH_ENTRY_POINTS = 18;
const MAX_NEAREST_GRAPH_NODES = 2;
const MAX_OUTER_GRAPH_NODES = 6;
const MAX_SEGMENTS_PER_PATH = 128;
const SEGMENT_CELL_COUNT = 28;

export function chooseNextRoute(
  graph: RouteGraph,
  shortest: ShortestPaths,
  candidates: readonly (readonly RoutingPoint[])[],
  outerRadius: number,
  radialFrontier: number
): RouteOption {
  const untouched = new SegmentGrid(candidates, outerRadius);
  const shortlist: RouteOption[] = [];
  const outerAnchors = graph.outerNodeIds(MAX_OUTER_GRAPH_NODES);

  for (let pathIndex = 0; pathIndex < candidates.length; pathIndex++) {
    const candidate = candidates[pathIndex];
    if (candidate === undefined || candidate.length < 2) {
      continue;
    }

    const profile = pathRadialProfile(candidate);
    const radialBacktrack = Math.max(0, radialFrontier - profile.outerRadius);
    const radialAdvance = Math.max(0, profile.centreRadius - radialFrontier);
    const entryIndexes = routingIndexes(candidate.length, MAX_PATH_ENTRY_POINTS);
    const directOptions: RouteOption[] = [];

    for (const entryIndex of entryIndexes) {
      const entry = candidate[entryIndex];
      if (entry === undefined) {
        continue;
      }
      for (const anchorNode of graph.nearestNodeIds(entry, MAX_NEAREST_GRAPH_NODES)) {
        const anchor = graph.point(anchorNode);
        keepBestBaseOptions(directOptions, {
          pathIndex,
          entryIndex,
          anchorNode,
          mode: "direct",
          usedDistance: shortest.distances[anchorNode] ?? Number.POSITIVE_INFINITY,
          newDistance: distance(anchor, entry),
          newExposure: segmentExposure(anchor, entry, outerRadius),
          edgeDistance: 0,
          crossings: 0,
          radialBacktrack,
          radialAdvance
        }, 3);
      }
    }
    shortlist.push(...directOptions);

    const outerOptions: RouteOption[] = [];
    const outerEntries = [...entryIndexes]
      .sort((first, second) =>
        pointRadius(candidate[second] ?? { x: 0, y: 0 }) -
        pointRadius(candidate[first] ?? { x: 0, y: 0 }))
      .slice(0, 2);

    for (const entryIndex of outerEntries) {
      const entry = candidate[entryIndex];
      if (entry === undefined) {
        continue;
      }
      for (const anchorNode of outerAnchors) {
        const anchor = graph.point(anchorNode);
        const edgeStart = pointOnOuterEdge(anchor, outerRadius);
        const edgeEnd = pointOnOuterEdge(entry, outerRadius);
        keepBestBaseOptions(outerOptions, {
          pathIndex,
          entryIndex,
          anchorNode,
          mode: "outer",
          usedDistance: shortest.distances[anchorNode] ?? Number.POSITIVE_INFINITY,
          newDistance: distance(anchor, edgeStart) + distance(edgeEnd, entry),
          newExposure:
            segmentExposure(anchor, edgeStart, outerRadius) +
            segmentExposure(edgeEnd, entry, outerRadius),
          edgeDistance: outerRadius * Math.abs(shortestAngleDelta(
            Math.atan2(edgeStart.y, edgeStart.x),
            Math.atan2(edgeEnd.y, edgeEnd.x)
          )),
          crossings: 0,
          radialBacktrack,
          radialAdvance
        }, 2);
      }
    }
    shortlist.push(...outerOptions);
  }

  let best: RouteOption | undefined;
  for (const option of shortlist) {
    const entry = candidates[option.pathIndex]?.[option.entryIndex];
    if (entry === undefined) {
      continue;
    }
    const anchor = graph.point(option.anchorNode);
    const crossings = option.mode === "outer"
      ? countOuterCrossings(anchor, entry, option.pathIndex, untouched, outerRadius)
      : untouched.countCrossings(anchor, entry, option.pathIndex);
    const scored = { ...option, crossings };
    if (isBetterRoute(scored, best)) {
      best = scored;
    }
  }

  return best ?? {
    pathIndex: 0,
    entryIndex: 0,
    anchorNode: 0,
    mode: "direct",
    usedDistance: 0,
    newDistance: 0,
    newExposure: 0,
    edgeDistance: 0,
    crossings: 0,
    radialBacktrack: 0,
    radialAdvance: 0
  };
}

function keepBestBaseOptions(
  options: RouteOption[],
  candidate: RouteOption,
  limit: number
): void {
  options.push(candidate);
  options.sort(compareBaseRoutes);
  if (options.length > limit) {
    options.length = limit;
  }
}

function compareBaseRoutes(first: RouteOption, second: RouteOption): number {
  const firstScore = [
    first.radialBacktrack,
    first.newExposure,
    first.radialAdvance,
    first.newDistance,
    first.edgeDistance * 0.02,
    first.usedDistance * 0.0005
  ];
  const secondScore = [
    second.radialBacktrack,
    second.newExposure,
    second.radialAdvance,
    second.newDistance,
    second.edgeDistance * 0.02,
    second.usedDistance * 0.0005
  ];
  return compareScores(firstScore, secondScore);
}

function isBetterRoute(candidate: RouteOption, current: RouteOption | undefined): boolean {
  if (current === undefined) {
    return true;
  }
  const candidateScore = [
    candidate.crossings,
    candidate.radialBacktrack,
    candidate.newExposure,
    candidate.radialAdvance,
    candidate.newDistance,
    candidate.edgeDistance * 0.02,
    candidate.usedDistance * 0.0005
  ];
  const currentScore = [
    current.crossings,
    current.radialBacktrack,
    current.newExposure,
    current.radialAdvance,
    current.newDistance,
    current.edgeDistance * 0.02,
    current.usedDistance * 0.0005
  ];
  return compareScores(candidateScore, currentScore) < 0;
}

function compareScores(first: readonly number[], second: readonly number[]): number {
  for (let index = 0; index < Math.max(first.length, second.length); index++) {
    const difference = (first[index] ?? 0) - (second[index] ?? 0);
    if (Math.abs(difference) > 1e-6) {
      return difference;
    }
  }
  return 0;
}

function countOuterCrossings(
  anchor: RoutingPoint,
  entry: RoutingPoint,
  pathIndex: number,
  untouched: SegmentGrid,
  outerRadius: number
): number {
  const edgeStart = pointOnOuterEdge(anchor, outerRadius);
  const edgeEnd = pointOnOuterEdge(entry, outerRadius);
  return untouched.countCrossings(anchor, edgeStart, pathIndex) +
    untouched.countCrossings(edgeEnd, entry, pathIndex);
}

class SegmentGrid {
  private readonly cells = new Map<string, IndexedSegment[]>();
  private readonly cellSize: number;

  public constructor(paths: readonly (readonly RoutingPoint[])[], outerRadius: number) {
    this.cellSize = Math.max(1, outerRadius * 2 / SEGMENT_CELL_COUNT);
    let id = 0;
    for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
      const path = paths[pathIndex];
      if (path === undefined || path.length < 2) {
        continue;
      }
      const indexes = routingIndexes(path.length, MAX_SEGMENTS_PER_PATH + 1);
      for (let position = 1; position < indexes.length; position++) {
        const start = path[indexes[position - 1] ?? 0];
        const end = path[indexes[position] ?? path.length - 1];
        if (start === undefined || end === undefined ||
            squaredDistance(start, end) <= EPSILON_SQUARED) {
          continue;
        }
        this.insert({ id: id++, pathIndex, start, end });
      }
    }
  }

  public countCrossings(
    start: RoutingPoint,
    end: RoutingPoint,
    excludedPathIndex: number
  ): number {
    if (squaredDistance(start, end) <= EPSILON_SQUARED) {
      return 0;
    }

    const minimumX = Math.floor(Math.min(start.x, end.x) / this.cellSize);
    const maximumX = Math.floor(Math.max(start.x, end.x) / this.cellSize);
    const minimumY = Math.floor(Math.min(start.y, end.y) / this.cellSize);
    const maximumY = Math.floor(Math.max(start.y, end.y) / this.cellSize);
    const candidates = new Map<number, IndexedSegment>();

    for (let x = minimumX; x <= maximumX; x++) {
      for (let y = minimumY; y <= maximumY; y++) {
        const cell = this.cells.get(`${x},${y}`);
        if (cell !== undefined) {
          for (const segment of cell) {
            candidates.set(segment.id, segment);
          }
        }
      }
    }

    let crossings = 0;
    for (const segment of candidates.values()) {
      if (segment.pathIndex !== excludedPathIndex &&
          segmentsCrossAwayFromEndpoints(start, end, segment.start, segment.end)) {
        crossings++;
      }
    }
    return crossings;
  }

  private insert(segment: IndexedSegment): void {
    const minimumX = Math.floor(Math.min(segment.start.x, segment.end.x) / this.cellSize);
    const maximumX = Math.floor(Math.max(segment.start.x, segment.end.x) / this.cellSize);
    const minimumY = Math.floor(Math.min(segment.start.y, segment.end.y) / this.cellSize);
    const maximumY = Math.floor(Math.max(segment.start.y, segment.end.y) / this.cellSize);
    for (let x = minimumX; x <= maximumX; x++) {
      for (let y = minimumY; y <= maximumY; y++) {
        const key = `${x},${y}`;
        const cell = this.cells.get(key);
        if (cell === undefined) {
          this.cells.set(key, [segment]);
        } else {
          cell.push(segment);
        }
      }
    }
  }
}
