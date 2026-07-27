export interface Pt {
  readonly x: number;
  readonly y: number;
}

export const EPSILON_SQUARED = 1e-9;
const OUTER_ARC_STEP = Math.PI / 720;

export function walkPth(
  path: readonly Pt[],
  requestedEntryIndex: number,
  outerRadius: number
): Pt[] {
  const clean = uniqPts(path);
  if (clean.length < 2) {
    return [...clean];
  }

  const closureTolerance = Math.max(1e-6, outerRadius * 1e-5);
  const first = clean[0];
  const last = clean.at(-1);
  const closed = first !== undefined && last !== undefined &&
    dist2(first, last) <= closureTolerance * closureTolerance;

  if (closed) {
    const core = clean.slice(0, -1);
    if (core.length < 2) {
      return clean;
    }
    const entryIndex = requestedEntryIndex >= core.length
      ? 0
      : clampInt(requestedEntryIndex, 0, core.length - 1);
    return uniqPts([
      ...core.slice(entryIndex),
      ...core.slice(0, entryIndex + 1)
    ]);
  }

  const entryIndex = clampInt(requestedEntryIndex, 0, clean.length - 1);
  if (entryIndex === 0) {
    return clean;
  }
  if (entryIndex === clean.length - 1) {
    return [...clean].reverse();
  }

  const leftLength = pthLen(clean.slice(0, entryIndex + 1));
  const rightLength = pthLen(clean.slice(entryIndex));
  if (leftLength <= rightLength) {
    return uniqPts([
      ...clean.slice(0, entryIndex + 1).reverse(),
      ...clean.slice(1, entryIndex + 1),
      ...clean.slice(entryIndex + 1)
    ]);
  }

  return uniqPts([
    ...clean.slice(entryIndex),
    ...clean.slice(entryIndex, clean.length - 1).reverse(),
    ...clean.slice(0, entryIndex).reverse()
  ]);
}

export function outerPt(
  paths: readonly (readonly Pt[])[]
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

export function routeIdx(length: number, maximum: number): number[] {
  if (length <= maximum) {
    return Array.from({ length }, (_value, index) => index);
  }
  const step = Math.max(1, Math.ceil((length - 1) / (maximum - 1)));
  const indexes: number[] = [];
  for (let index = 0; index < length; index += step) {
    indexes.push(index);
  }
  if (indexes.at(-1) !== length - 1) {
    indexes.push(length - 1);
  }
  return indexes;
}

export function edgeJoin(
  start: Pt,
  end: Pt,
  outerRadius: number
): Pt[] {
  const edgeStart = edgePt(start, outerRadius);
  const edgeEnd = edgePt(end, outerRadius);
  return uniqPts([
    ...linePts(start, edgeStart, outerRadius),
    ...edgeArc(edgeStart, edgeEnd, outerRadius).slice(1),
    ...linePts(edgeEnd, end, outerRadius).slice(1)
  ]);
}

export function linePts(
  start: Pt,
  end: Pt,
  outerRadius: number
): Pt[] {
  const length = distance(start, end);
  const stepLength = Math.max(1, outerRadius / 256);
  const steps = Math.max(1, Math.ceil(length / stepLength));
  return Array.from({ length: steps + 1 }, (_value, step) => ({
    x: start.x + (end.x - start.x) * step / steps,
    y: start.y + (end.y - start.y) * step / steps
  }));
}

export function edgeArc(
  start: Pt,
  end: Pt,
  radius: number
): Pt[] {
  const startAngle = Math.atan2(start.y, start.x);
  const delta = angleDiff(startAngle, Math.atan2(end.y, end.x));
  const steps = Math.max(1, Math.ceil(Math.abs(delta) / OUTER_ARC_STEP));
  return Array.from({ length: steps + 1 }, (_value, step) => {
    const angle = startAngle + delta * step / steps;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}

export function edgePt(point: Pt, radius: number): Pt {
  const currentRadius = ptRad(point);
  if (currentRadius < 1e-9) {
    return { x: -radius, y: 0 };
  }
  const scale = radius / currentRadius;
  return { x: point.x * scale, y: point.y * scale };
}

export function segExposure(
  start: Pt,
  end: Pt,
  outerRadius: number
): number {
  const samples = 12;
  const segmentLength = distance(start, end);
  if (segmentLength <= 0) {
    return 0;
  }
  let totalVisibility = 0;
  for (let sample = 0; sample <= samples; sample++) {
    const ratio = sample / samples;
    const point = {
      x: start.x + (end.x - start.x) * ratio,
      y: start.y + (end.y - start.y) * ratio
    };
    const inward = Math.max(0, 1 - ptRad(point) / outerRadius);
    totalVisibility += inward * inward;
  }
  return segmentLength * totalVisibility / (samples + 1);
}

export function segCross(
  firstStart: Pt,
  firstEnd: Pt,
  secondStart: Pt,
  secondEnd: Pt
): boolean {
  const denominator =
    (firstEnd.x - firstStart.x) * (secondEnd.y - secondStart.y) -
    (firstEnd.y - firstStart.y) * (secondEnd.x - secondStart.x);
  if (Math.abs(denominator) < 1e-9) {
    return false;
  }

  const firstParameter = (
    (secondStart.x - firstStart.x) * (secondEnd.y - secondStart.y) -
    (secondStart.y - firstStart.y) * (secondEnd.x - secondStart.x)
  ) / denominator;
  const secondParameter = (
    (secondStart.x - firstStart.x) * (firstEnd.y - firstStart.y) -
    (secondStart.y - firstStart.y) * (firstEnd.x - firstStart.x)
  ) / denominator;
  const margin = 1e-5;
  return firstParameter > margin && firstParameter < 1 - margin &&
    secondParameter > margin && secondParameter < 1 - margin;
}

export function angleDiff(start: number, end: number): number {
  let delta = end - start;
  while (delta > Math.PI) {
    delta -= Math.PI * 2;
  }
  while (delta < -Math.PI) {
    delta += Math.PI * 2;
  }
  return delta;
}

export function ptRad(point: Pt): number {
  return Math.hypot(point.x, point.y);
}

export function pthLen(points: readonly Pt[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous !== undefined && current !== undefined) {
      total += distance(previous, current);
    }
  }
  return total;
}

export function addPts(target: Pt[], points: readonly Pt[]): void {
  for (const point of points) {
    const previous = target.at(-1);
    if (previous === undefined || dist2(previous, point) > EPSILON_SQUARED) {
      target.push(point);
    }
  }
}

export function uniqPts(points: readonly Pt[]): Pt[] {
  const output: Pt[] = [];
  addPts(output, points);
  return output;
}

export function distance(first: Pt, second: Pt): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

export function dist2(first: Pt, second: Pt): number {
  return (first.x - second.x) ** 2 + (first.y - second.y) ** 2;
}

function clampInt(value: number, minimum: number, maximum: number): number {
  return Math.round(Math.min(maximum, Math.max(minimum, value)));
}
