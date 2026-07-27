import { radProf } from "./radialRouting";
import { PthGraph, type ShortPth } from "./routeGraph";
import {
  distance,
  EPSILON_SQUARED,
  edgePt,
  ptRad,
  routeIdx,
  segExposure,
  segCross,
  angleDiff,
  dist2,
  type Pt
} from "./routingGeometry";

export interface RtOpt {
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

interface Seg {
  readonly id: number;
  readonly pathIndex: number;
  readonly start: Pt;
  readonly end: Pt;
}

const MAX_PATH_ENTRY_POINTS = 18;
const MAX_NEAREST_GRAPH_NODES = 2;
const MAX_OUTER_GRAPH_NODES = 6;
const MAX_SEGMENTS_PER_PATH = 128;
const SEGMENT_CELL_COUNT = 28;

export function pickNext(
  graph: PthGraph,
  shortest: ShortPth,
  candidates: readonly (readonly Pt[])[],
  outerRadius: number,
  radialFrontier: number,
  startFromOuterEdge = false
): RtOpt {
  const untouched = new SegGrid(candidates, outerRadius);
  const shortlist: RtOpt[] = [];
  const outerAnchors = graph.edgeIds(MAX_OUTER_GRAPH_NODES);

  for (let pathIndex = 0; pathIndex < candidates.length; pathIndex++) {
    const candidate = candidates[pathIndex];
    if (candidate === undefined || candidate.length < 2) {
      continue;
    }

    const profile = radProf(candidate);
    const radialBacktrack = startFromOuterEdge
      ? Math.max(0, profile.innerRadius - radialFrontier)
      : Math.max(0, radialFrontier - profile.outerRadius);
    const radialAdvance = startFromOuterEdge
      ? Math.max(0, radialFrontier - profile.centreRadius)
      : Math.max(0, profile.centreRadius - radialFrontier);
    const entryIndexes = routeIdx(candidate.length, MAX_PATH_ENTRY_POINTS);
    const directOptions: RtOpt[] = [];

    for (const entryIndex of entryIndexes) {
      const entry = candidate[entryIndex];
      if (entry === undefined) {
        continue;
      }
      for (const anchorNode of graph.nearIds(entry, MAX_NEAREST_GRAPH_NODES)) {
        const anchor = graph.point(anchorNode);
        keepOpt(directOptions, {
          pathIndex,
          entryIndex,
          anchorNode,
          mode: "direct",
          usedDistance: shortest.distances[anchorNode] ?? Number.POSITIVE_INFINITY,
          newDistance: distance(anchor, entry),
          newExposure: segExposure(anchor, entry, outerRadius),
          edgeDistance: 0,
          crossings: 0,
          radialBacktrack,
          radialAdvance
        }, 3);
      }
    }
    shortlist.push(...directOptions);

    const outerOptions: RtOpt[] = [];
    const outerEntries = [...entryIndexes]
      .sort((first, second) =>
        ptRad(candidate[second] ?? { x: 0, y: 0 }) -
        ptRad(candidate[first] ?? { x: 0, y: 0 }))
      .slice(0, 2);

    for (const entryIndex of outerEntries) {
      const entry = candidate[entryIndex];
      if (entry === undefined) {
        continue;
      }
      for (const anchorNode of outerAnchors) {
        const anchor = graph.point(anchorNode);
        const edgeStart = edgePt(anchor, outerRadius);
        const edgeEnd = edgePt(entry, outerRadius);
        keepOpt(outerOptions, {
          pathIndex,
          entryIndex,
          anchorNode,
          mode: "outer",
          usedDistance: shortest.distances[anchorNode] ?? Number.POSITIVE_INFINITY,
          newDistance: distance(anchor, edgeStart) + distance(edgeEnd, entry),
          newExposure:
            segExposure(anchor, edgeStart, outerRadius) +
            segExposure(edgeEnd, entry, outerRadius),
          edgeDistance: outerRadius * Math.abs(angleDiff(
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

  let best: RtOpt | undefined;
  for (const option of shortlist) {
    const entry = candidates[option.pathIndex]?.[option.entryIndex];
    if (entry === undefined) {
      continue;
    }
    const anchor = graph.point(option.anchorNode);
    const crossings = option.mode === "outer"
      ? countEdgeCross(anchor, entry, option.pathIndex, untouched, outerRadius)
      : untouched.countCross(anchor, entry, option.pathIndex);
    const scored = { ...option, crossings };
    if (betterOpt(scored, best)) {
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

function keepOpt(
  options: RtOpt[],
  candidate: RtOpt,
  limit: number
): void {
  options.push(candidate);
  options.sort(cmpOpt);
  if (options.length > limit) {
    options.length = limit;
  }
}

function cmpOpt(first: RtOpt, second: RtOpt): number {
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
  return cmpScore(firstScore, secondScore);
}

function betterOpt(candidate: RtOpt, current: RtOpt | undefined): boolean {
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
  return cmpScore(candidateScore, currentScore) < 0;
}

function cmpScore(first: readonly number[], second: readonly number[]): number {
  for (let index = 0; index < Math.max(first.length, second.length); index++) {
    const difference = (first[index] ?? 0) - (second[index] ?? 0);
    if (Math.abs(difference) > 1e-6) {
      return difference;
    }
  }
  return 0;
}

function countEdgeCross(
  anchor: Pt,
  entry: Pt,
  pathIndex: number,
  untouched: SegGrid,
  outerRadius: number
): number {
  const edgeStart = edgePt(anchor, outerRadius);
  const edgeEnd = edgePt(entry, outerRadius);
  return untouched.countCross(anchor, edgeStart, pathIndex) +
    untouched.countCross(edgeEnd, entry, pathIndex);
}

class SegGrid {
  private readonly cells = new Map<string, Seg[]>();
  private readonly cellSize: number;

  public constructor(paths: readonly (readonly Pt[])[], outerRadius: number) {
    this.cellSize = Math.max(1, outerRadius * 2 / SEGMENT_CELL_COUNT);
    let id = 0;
    for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
      const path = paths[pathIndex];
      if (path === undefined || path.length < 2) {
        continue;
      }
      const indexes = routeIdx(path.length, MAX_SEGMENTS_PER_PATH + 1);
      for (let position = 1; position < indexes.length; position++) {
        const start = path[indexes[position - 1] ?? 0];
        const end = path[indexes[position] ?? path.length - 1];
        if (start === undefined || end === undefined ||
            dist2(start, end) <= EPSILON_SQUARED) {
          continue;
        }
        this.insert({ id: id++, pathIndex, start, end });
      }
    }
  }

  public countCross(
    start: Pt,
    end: Pt,
    excludedPathIndex: number
  ): number {
    if (dist2(start, end) <= EPSILON_SQUARED) {
      return 0;
    }

    const minimumX = Math.floor(Math.min(start.x, end.x) / this.cellSize);
    const maximumX = Math.floor(Math.max(start.x, end.x) / this.cellSize);
    const minimumY = Math.floor(Math.min(start.y, end.y) / this.cellSize);
    const maximumY = Math.floor(Math.max(start.y, end.y) / this.cellSize);
    const candidates = new Map<number, Seg>();

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
          segCross(start, end, segment.start, segment.end)) {
        crossings++;
      }
    }
    return crossings;
  }

  private insert(segment: Seg): void {
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
