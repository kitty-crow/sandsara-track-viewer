import {
  distance,
  pointOnOuterEdge,
  pointRadius,
  routingIndexes,
  segmentsCrossAwayFromEndpoints,
  squaredDistance,
  type RoutingPoint
} from "./routingGeometry";

export interface PathRadialProfile {
  readonly innerRadius: number;
  readonly centreRadius: number;
  readonly outerRadius: number;
}

export interface RadialStartSelection {
  readonly pathIndex: number;
  readonly pointIndex: number;
  readonly crossings: number;
}

const MAX_START_POINTS = 32;
const MAX_PATH_SEGMENTS = 160;
const EPSILON = 1e-6;

export function pathRadialProfile(
  path: readonly RoutingPoint[]
): PathRadialProfile {
  if (path.length === 0) {
    return { innerRadius: 0, centreRadius: 0, outerRadius: 0 };
  }

  let innerRadius = Number.POSITIVE_INFINITY;
  let outerRadius = 0;
  let totalRadius = 0;

  for (const point of path) {
    const radius = pointRadius(point);
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
export function selectRadialStartPathPoint(
  paths: readonly (readonly RoutingPoint[])[],
  outerRadius: number,
  startFromOuterEdge: boolean
): RadialStartSelection {
  let best: RadialStartSelection | undefined;
  let bestScore: readonly number[] | undefined;

  for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
    const path = paths[pathIndex];
    if (path === undefined || path.length < 2) {
      continue;
    }

    const profile = pathRadialProfile(path);
    const entryIndexes = routingIndexes(path.length, MAX_START_POINTS);

    for (const pointIndex of entryIndexes) {
      const point = path[pointIndex];
      if (point === undefined) {
        continue;
      }

      const edgePoint = pointOnOuterEdge(point, outerRadius);
      const crossings = startFromOuterEdge
        ? countCrossings(edgePoint, point, paths, pathIndex)
        : 0;
      const approachDistance = startFromOuterEdge
        ? distance(edgePoint, point)
        : -pointRadius(point);
      const score = [
        crossings,
        profile.centreRadius,
        approachDistance,
        profile.outerRadius - profile.innerRadius
      ];

      if (bestScore === undefined || compareScores(score, bestScore) < 0) {
        best = { pathIndex, pointIndex, crossings };
        bestScore = score;
      }
    }
  }

  return best ?? { pathIndex: 0, pointIndex: 0, crossings: 0 };
}

function countCrossings(
  start: RoutingPoint,
  end: RoutingPoint,
  paths: readonly (readonly RoutingPoint[])[],
  excludedPathIndex: number
): number {
  if (squaredDistance(start, end) <= EPSILON * EPSILON) {
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

    const indexes = routingIndexes(path.length, MAX_PATH_SEGMENTS + 1);
    for (let index = 1; index < indexes.length; index++) {
      const segmentStart = path[indexes[index - 1] ?? 0];
      const segmentEnd = path[indexes[index] ?? path.length - 1];
      if (
        segmentStart !== undefined &&
        segmentEnd !== undefined &&
        segmentsCrossAwayFromEndpoints(start, end, segmentStart, segmentEnd)
      ) {
        crossings++;
      }
    }
  }
  return crossings;
}

function compareScores(
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
