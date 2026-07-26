export interface RoutingPoint {
  readonly x: number;
  readonly y: number;
}

export interface RoutedPathResult {
  readonly points: RoutingPoint[];
  readonly connectorCount: number;
}

interface NearestPair {
  readonly firstIndex: number;
  readonly secondIndex: number;
  readonly distanceSquared: number;
}

interface RouteChoice {
  readonly pathIndex: number;
  readonly anchorIndex: number;
  readonly entryIndex: number;
  readonly useOuterEdge: boolean;
  readonly score: number;
}

const MAX_SEARCH_POINTS = 144;
const RETRACE_WEIGHT = 0.001;
const OUTER_ARC_WEIGHT = 0.03;
const OUTER_ARC_STEP = Math.PI / 720;
const EPSILON_SQUARED = 1e-9;

/**
 * Joins disconnected drawing paths without treating every transition as a new
 * straight chord. Completed geometry may be retraced at almost no visual cost,
 * and the table edge is used as a low-visibility route when it avoids a long
 * line through the artwork.
 */
export function joinPathsByDrawingRoute(
  paths: readonly (readonly RoutingPoint[])[],
  requestedOuterRadius: number
): RoutedPathResult {
  const outerRadius = Math.max(1, Math.abs(requestedOuterRadius));
  const remaining = paths
    .map(path => removeAdjacentDuplicates(path))
    .filter(path => path.length >= 2);

  if (remaining.length === 0) {
    return { points: [], connectorCount: 0 };
  }

  const firstSelection = outermostPathPoint(remaining);
  const firstPath = remaining.splice(firstSelection.pathIndex, 1)[0];
  if (firstPath === undefined) {
    return { points: [], connectorCount: 0 };
  }

  let currentWalk = walkEntirePathFrom(firstPath, firstSelection.pointIndex, outerRadius);
  const output = [...currentWalk];
  let connectorCount = 0;

  while (remaining.length > 0) {
    const choice = chooseNextRoute(currentWalk, remaining, outerRadius);
    const nextPath = remaining.splice(choice.pathIndex, 1)[0];
    if (nextPath === undefined) {
      continue;
    }

    const candidateWalk = walkEntirePathFrom(nextPath, choice.entryIndex, outerRadius);
    const candidateStart = candidateWalk[0];
    const anchor = currentWalk[choice.anchorIndex];
    if (candidateStart === undefined || anchor === undefined) {
      currentWalk = candidateWalk;
      appendPoints(output, candidateWalk);
      continue;
    }

    const retrace = currentWalk.slice(choice.anchorIndex).reverse();
    appendPoints(output, retrace.slice(1));

    if (choice.useOuterEdge) {
      const edgeStart = pointOnOuterEdge(anchor, outerRadius);
      const edgeEnd = pointOnOuterEdge(candidateStart, outerRadius);
      appendPoint(output, edgeStart);
      appendPoints(output, outerEdgeArc(edgeStart, edgeEnd, outerRadius).slice(1));
      appendPoint(output, candidateStart);
      connectorCount++;
    } else {
      if (squaredDistance(anchor, candidateStart) > EPSILON_SQUARED) {
        connectorCount++;
      }
      appendPoint(output, candidateStart);
    }

    appendPoints(output, candidateWalk.slice(1));
    currentWalk = candidateWalk;
  }

  return {
    points: removeAdjacentDuplicates(output),
    connectorCount
  };
}

function chooseNextRoute(
  currentWalk: readonly RoutingPoint[],
  candidates: readonly (readonly RoutingPoint[])[],
  outerRadius: number
): RouteChoice {
  const suffixDistances = suffixPolylineDistances(currentWalk);
  const outerAnchorIndex = outermostPointIndex(currentWalk);
  const outerAnchor = currentWalk[outerAnchorIndex];

  let best: RouteChoice | undefined;

  for (let pathIndex = 0; pathIndex < candidates.length; pathIndex++) {
    const candidate = candidates[pathIndex];
    if (candidate === undefined || candidate.length < 2) {
      continue;
    }

    const nearest = nearestPair(currentWalk, candidate);
    const directDistance = Math.sqrt(nearest.distanceSquared);
    const directScore = directDistance +
      (suffixDistances[nearest.firstIndex] ?? 0) * RETRACE_WEIGHT;

    const outerEntryIndex = outermostPointIndex(candidate);
    const outerEntry = candidate[outerEntryIndex];
    let edgeScore = Number.POSITIVE_INFINITY;

    if (outerAnchor !== undefined && outerEntry !== undefined) {
      const radialDistance =
        Math.max(0, outerRadius - pointRadius(outerAnchor)) +
        Math.max(0, outerRadius - pointRadius(outerEntry));
      const arcDistance = outerRadius * Math.abs(shortestAngleDelta(
        Math.atan2(outerAnchor.y, outerAnchor.x),
        Math.atan2(outerEntry.y, outerEntry.x)
      ));
      edgeScore = radialDistance + arcDistance * OUTER_ARC_WEIGHT +
        (suffixDistances[outerAnchorIndex] ?? 0) * RETRACE_WEIGHT;
    }

    const useOuterEdge = edgeScore < directScore;
    const choice: RouteChoice = {
      pathIndex,
      anchorIndex: useOuterEdge ? outerAnchorIndex : nearest.firstIndex,
      entryIndex: useOuterEdge ? outerEntryIndex : nearest.secondIndex,
      useOuterEdge,
      score: useOuterEdge ? edgeScore : directScore
    };

    if (best === undefined || choice.score < best.score) {
      best = choice;
    }
  }

  if (best !== undefined) {
    return best;
  }

  return {
    pathIndex: 0,
    anchorIndex: Math.max(0, currentWalk.length - 1),
    entryIndex: 0,
    useOuterEdge: false,
    score: Number.POSITIVE_INFINITY
  };
}

function nearestPair(
  first: readonly RoutingPoint[],
  second: readonly RoutingPoint[]
): NearestPair {
  const firstSample = sampledIndexes(first.length);
  const secondSample = sampledIndexes(second.length);
  let best: NearestPair = {
    firstIndex: 0,
    secondIndex: 0,
    distanceSquared: Number.POSITIVE_INFINITY
  };

  for (const firstIndex of firstSample.indexes) {
    const firstPoint = first[firstIndex];
    if (firstPoint === undefined) {
      continue;
    }
    for (const secondIndex of secondSample.indexes) {
      const secondPoint = second[secondIndex];
      if (secondPoint === undefined) {
        continue;
      }
      const distanceSquared = squaredDistance(firstPoint, secondPoint);
      if (distanceSquared < best.distanceSquared) {
        best = { firstIndex, secondIndex, distanceSquared };
      }
    }
  }

  const firstStart = Math.max(0, best.firstIndex - firstSample.step);
  const firstEnd = Math.min(first.length - 1, best.firstIndex + firstSample.step);
  const secondStart = Math.max(0, best.secondIndex - secondSample.step);
  const secondEnd = Math.min(second.length - 1, best.secondIndex + secondSample.step);

  for (let firstIndex = firstStart; firstIndex <= firstEnd; firstIndex++) {
    const firstPoint = first[firstIndex];
    if (firstPoint === undefined) {
      continue;
    }
    for (let secondIndex = secondStart; secondIndex <= secondEnd; secondIndex++) {
      const secondPoint = second[secondIndex];
      if (secondPoint === undefined) {
        continue;
      }
      const distanceSquared = squaredDistance(firstPoint, secondPoint);
      if (distanceSquared < best.distanceSquared) {
        best = { firstIndex, secondIndex, distanceSquared };
      }
    }
  }

  return best;
}

function sampledIndexes(length: number): { readonly indexes: number[]; readonly step: number } {
  if (length <= MAX_SEARCH_POINTS) {
    return {
      indexes: Array.from({ length }, (_value, index) => index),
      step: 1
    };
  }

  const step = Math.max(1, Math.ceil((length - 1) / (MAX_SEARCH_POINTS - 1)));
  const indexes: number[] = [];
  for (let index = 0; index < length; index += step) {
    indexes.push(index);
  }
  if (indexes.at(-1) !== length - 1) {
    indexes.push(length - 1);
  }
  return { indexes, step };
}

function walkEntirePathFrom(
  path: readonly RoutingPoint[],
  requestedEntryIndex: number,
  outerRadius: number
): RoutingPoint[] {
  const clean = removeAdjacentDuplicates(path);
  if (clean.length < 2) {
    return [...clean];
  }

  const closureTolerance = Math.max(1e-6, outerRadius * 1e-5);
  const first = clean[0];
  const last = clean.at(-1);
  const closed = first !== undefined && last !== undefined &&
    squaredDistance(first, last) <= closureTolerance * closureTolerance;

  if (closed) {
    const core = clean.slice(0, -1);
    if (core.length < 2) {
      return clean;
    }
    const entryIndex = requestedEntryIndex >= core.length
      ? 0
      : clampInteger(requestedEntryIndex, 0, core.length - 1);
    return removeAdjacentDuplicates([
      ...core.slice(entryIndex),
      ...core.slice(0, entryIndex + 1)
    ]);
  }

  const entryIndex = clampInteger(requestedEntryIndex, 0, clean.length - 1);
  if (entryIndex === 0) {
    return clean;
  }
  if (entryIndex === clean.length - 1) {
    return [...clean].reverse();
  }

  const leftLength = polylineLength(clean, 0, entryIndex);
  const rightLength = polylineLength(clean, entryIndex, clean.length - 1);

  if (leftLength <= rightLength) {
    return removeAdjacentDuplicates([
      ...clean.slice(0, entryIndex + 1).reverse(),
      ...clean.slice(1, entryIndex + 1),
      ...clean.slice(entryIndex + 1)
    ]);
  }

  return removeAdjacentDuplicates([
    ...clean.slice(entryIndex),
    ...clean.slice(entryIndex, clean.length - 1).reverse(),
    ...clean.slice(0, entryIndex).reverse()
  ]);
}

function outermostPathPoint(
  paths: readonly (readonly RoutingPoint[])[]
): { readonly pathIndex: number; readonly pointIndex: number } {
  let bestPathIndex = 0;
  let bestPointIndex = 0;
  let bestRadiusSquared = Number.NEGATIVE_INFINITY;

  for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
    const path = paths[pathIndex];
    if (path === undefined) {
      continue;
    }
    for (let pointIndex = 0; pointIndex < path.length; pointIndex++) {
      const point = path[pointIndex];
      if (point === undefined) {
        continue;
      }
      const radiusSquared = point.x * point.x + point.y * point.y;
      if (radiusSquared > bestRadiusSquared) {
        bestRadiusSquared = radiusSquared;
        bestPathIndex = pathIndex;
        bestPointIndex = pointIndex;
      }
    }
  }

  return { pathIndex: bestPathIndex, pointIndex: bestPointIndex };
}

function outermostPointIndex(points: readonly RoutingPoint[]): number {
  let bestIndex = 0;
  let bestRadiusSquared = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (point === undefined) {
      continue;
    }
    const radiusSquared = point.x * point.x + point.y * point.y;
    if (radiusSquared > bestRadiusSquared) {
      bestRadiusSquared = radiusSquared;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function suffixPolylineDistances(points: readonly RoutingPoint[]): number[] {
  const output = new Array<number>(points.length).fill(0);
  for (let index = points.length - 2; index >= 0; index--) {
    const current = points[index];
    const next = points[index + 1];
    output[index] = (output[index + 1] ?? 0) +
      (current === undefined || next === undefined ? 0 : distance(current, next));
  }
  return output;
}

function polylineLength(
  points: readonly RoutingPoint[],
  startIndex: number,
  endIndex: number
): number {
  let total = 0;
  for (let index = startIndex + 1; index <= endIndex; index++) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous !== undefined && current !== undefined) {
      total += distance(previous, current);
    }
  }
  return total;
}

function outerEdgeArc(
  start: RoutingPoint,
  end: RoutingPoint,
  radius: number
): RoutingPoint[] {
  const startAngle = Math.atan2(start.y, start.x);
  const delta = shortestAngleDelta(startAngle, Math.atan2(end.y, end.x));
  const steps = Math.max(1, Math.ceil(Math.abs(delta) / OUTER_ARC_STEP));
  const output: RoutingPoint[] = [];

  for (let step = 0; step <= steps; step++) {
    const angle = startAngle + delta * step / steps;
    output.push({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius
    });
  }

  return output;
}

function pointOnOuterEdge(point: RoutingPoint, radius: number): RoutingPoint {
  const currentRadius = pointRadius(point);
  if (currentRadius < 1e-9) {
    return { x: -radius, y: 0 };
  }
  const scale = radius / currentRadius;
  return { x: point.x * scale, y: point.y * scale };
}

function shortestAngleDelta(start: number, end: number): number {
  let delta = end - start;
  while (delta > Math.PI) {
    delta -= Math.PI * 2;
  }
  while (delta < -Math.PI) {
    delta += Math.PI * 2;
  }
  return delta;
}

function pointRadius(point: RoutingPoint): number {
  return Math.hypot(point.x, point.y);
}

function appendPoints(target: RoutingPoint[], points: readonly RoutingPoint[]): void {
  for (const point of points) {
    appendPoint(target, point);
  }
}

function appendPoint(target: RoutingPoint[], point: RoutingPoint): void {
  const previous = target.at(-1);
  if (previous === undefined || squaredDistance(previous, point) > EPSILON_SQUARED) {
    target.push(point);
  }
}

function removeAdjacentDuplicates(points: readonly RoutingPoint[]): RoutingPoint[] {
  const output: RoutingPoint[] = [];
  appendPoints(output, points);
  return output;
}

function distance(first: RoutingPoint, second: RoutingPoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function squaredDistance(first: RoutingPoint, second: RoutingPoint): number {
  return (first.x - second.x) ** 2 + (first.y - second.y) ** 2;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.round(Math.min(maximum, Math.max(minimum, value)));
}
