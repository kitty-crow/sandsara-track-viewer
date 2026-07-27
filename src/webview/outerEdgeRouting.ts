import { RouteGraph } from "./routeGraph";
import {
  appendPoints,
  pointOnOuterEdge,
  polylineLength,
  removeAdjacentDuplicates,
  sampledLine,
  type RoutingPoint
} from "./routingGeometry";

export interface OuterEdgeRouteResult {
  readonly points: RoutingPoint[];
  readonly connectorCount: number;
  readonly newConnectorDistance: number;
}

/**
 * Reorients an already completed inner-to-outer route so the physical draw starts
 * at the perimeter and proceeds outside-in. The final movement is a shortest path
 * over the graph of lines that have already been travelled, so the ball returns
 * to the exact starting perimeter point without cutting across untouched sand.
 */
export function orientRouteFromAndBackToOuterEdge(
  points: readonly RoutingPoint[],
  requestedOuterRadius: number
): OuterEdgeRouteResult {
  const outerRadius = Math.max(1, Math.abs(requestedOuterRadius));
  const clean = removeAdjacentDuplicates(points);
  if (clean.length < 2) {
    return {
      points: clean,
      connectorCount: 0,
      newConnectorDistance: 0
    };
  }

  const reversed = [...clean].reverse();
  const firstDrawingPoint = reversed[0];
  if (firstDrawingPoint === undefined) {
    return {
      points: [],
      connectorCount: 0,
      newConnectorDistance: 0
    };
  }

  const outerStart = pointOnOuterEdge(firstDrawingPoint, outerRadius);
  const entry = sampledLine(outerStart, firstDrawingPoint, outerRadius);
  const output = [...entry];
  appendPoints(output, reversed.slice(1));

  const graph = new RouteGraph(outerRadius);
  const { startNode, endNode } = graph.addPolyline(output);
  const shortest = graph.shortestPaths(endNode);
  const retrace = graph.reconstructPath(shortest, startNode);
  appendPoints(output, retrace.slice(1));

  const entryDistance = polylineLength(entry);
  return {
    points: removeAdjacentDuplicates(output),
    connectorCount: entryDistance > 1e-9 ? 1 : 0,
    newConnectorDistance: entryDistance
  };
}
