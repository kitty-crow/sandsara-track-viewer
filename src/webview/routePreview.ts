import {
  pointOnOuterEdge,
  removeAdjacentDuplicates,
  type RoutingPoint
} from "./routingGeometry";

/**
 * Converts the canonical inner-to-outer worker route into the direction shown
 * by outer-edge mode. This is a display-only transform: checkpoints continue
 * to store the canonical route so interrupted calculations remain resumable.
 */
export function routeProgressPreview(
  points: readonly RoutingPoint[],
  requestedOuterRadius: number,
  startAndFinishAtOuterEdge: boolean
): RoutingPoint[] {
  const clean = removeAdjacentDuplicates(points);
  if (!startAndFinishAtOuterEdge || clean.length === 0) {
    return clean;
  }

  const outerRadius = Math.max(1, Math.abs(requestedOuterRadius));
  const reversed = [...clean].reverse();
  const firstDrawingPoint = reversed[0];
  if (firstDrawingPoint === undefined) {
    return [];
  }

  return removeAdjacentDuplicates([
    pointOnOuterEdge(firstDrawingPoint, outerRadius),
    ...reversed
  ]);
}
