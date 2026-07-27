import {
  distance,
  edgePt,
  ptRad,
  routeIdx,
  segCross,
  dist2,
  type Pt
} from "./routingGeometry";

export interface RadProf {
  readonly innerRadius: number;
  readonly centreRadius: number;
  readonly outerRadius: number;
}

export interface StartSel {
  readonly pathIndex: number;
  readonly pointIndex: number;
  readonly crossings: number;
}

const MAX_START_POINTS = 32;
const MAX_PATH_SEGMENTS = 160;
const EPSILON = 1e-6;

export function radProf(
  path: readonly Pt[]
): RadProf {
  if (path.length === 0) {
    return { innerRadius: 0, centreRadius: 0, outerRadius: 0 };
  }

  let innerRadius = Number.POSITIVE_INFINITY;
  let outerRadius = 0;
  let totalRadius = 0;

  for (const point of path) {
    const radius = ptRad(point);
    innerRadius = Math.min(innerRadius, radius);
    outerRadius = Math.max(outerRadius, radius);
    totalRadius += radius;
  }

  return {
    innerRadius: Number.isFinite(innerRadius) ? innerRadius : 0,
    centreRadius: totalRadius / path.length,
    outerRadius
  };
}

/**
 * Selects the first radial band and the least destructive entry point. When the
 * ball starts at the perimeter, crossing untouched paths remains more important
 * than beginning at the mathematically innermost contour.
 */
export function pickStart(
  paths: readonly (readonly Pt[])[],
  outerRadius: number,
  startFromOuterEdge: boolean
): StartSel {
  let best: StartSel | undefined;
  let bestScore: readonly number[] | undefined;

  for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
    const path = paths[pathIndex];
    if (path === undefined || path.length < 2) {
      continue;
    }

    const profile = radProf(path);
    const entryIndexes = routeIdx(path.length, MAX_START_POINTS);

    for (const pointIndex of entryIndexes) {
      const point = path[pointIndex];
      if (point === undefined) {
        continue;
      }

      const edgePoint = edgePt(point, outerRadius);
      const crossings = startFromOuterEdge
        ? countCross(edgePoint, point, paths, pathIndex)
        : 0;
      const approachDistance = startFromOuterEdge
        ? distance(edgePoint, point)
        : -ptRad(point);
      const score = [
        crossings,
        startFromOuterEdge ? -profile.centreRadius : profile.centreRadius,
        approachDistance,
        profile.outerRadius - profile.innerRadius
      ];

      if (bestScore === undefined || cmpScore(score, bestScore) < 0) {
        best = { pathIndex, pointIndex, crossings };
        bestScore = score;
      }
    }
  }

  return best ?? { pathIndex: 0, pointIndex: 0, crossings: 0 };
}

function countCross(
  start: Pt,
  end: Pt,
  paths: readonly (readonly Pt[])[],
  excludedPathIndex: number
): number {
  if (dist2(start, end) <= EPSILON * EPSILON) {
    return 0;
  }

  let crossings = 0;
  for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
    if (pathIndex === excludedPathIndex) {
      continue;
    }
    const path = paths[pathIndex];
    if (path === undefined || path.length < 2) {
      continue;
    }

    const indexes = routeIdx(path.length, MAX_PATH_SEGMENTS + 1);
    for (let index = 1; index < indexes.length; index++) {
      const segmentStart = path[indexes[index - 1] ?? 0];
      const segmentEnd = path[indexes[index] ?? path.length - 1];
      if (
        segmentStart !== undefined &&
        segmentEnd !== undefined &&
        segCross(start, end, segmentStart, segmentEnd)
      ) {
        crossings++;
      }
    }
  }
  return crossings;
}

function cmpScore(
  first: readonly number[],
  second: readonly number[]
): number {
  for (let index = 0; index < Math.max(first.length, second.length); index++) {
    const difference = (first[index] ?? 0) - (second[index] ?? 0);
    if (Math.abs(difference) > EPSILON) {
      return difference;
    }
  }
  return 0;
}
