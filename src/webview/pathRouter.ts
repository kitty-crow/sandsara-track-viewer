import { orientRouteFromAndBackToOuterEdge } from "./outerEdgeRouting";
import { RouteGraph } from "./routeGraph";
import { chooseNextRoute } from "./routePlanner";
import {
  pathRadialProfile,
  selectRadialStartPathPoint
} from "./radialRouting";
import {
  appendPoints,
  outerConnector,
  removeAdjacentDuplicates,
  sampledLine,
  walkEntirePathFrom,
  type RoutingPoint
} from "./routingGeometry";

export type { RoutingPoint } from "./routingGeometry";

export interface RoutedPathResult {
  readonly points: RoutingPoint[];
  readonly connectorCount: number;
  readonly newConnectorDistance: number;
  readonly crossingCount: number;
}

/**
 * Joins disconnected drawing paths while treating every line already travelled
 * as reusable track. Crossing untouched geometry is avoided first. The normal
 * route advances from the centre towards the perimeter; outer-ring mode reverses
 * that completed walk and retraces travelled geometry to finish at the perimeter.
 */
export function joinPathsByDrawingRoute(
  paths: readonly (readonly RoutingPoint[])[],
  requestedOuterRadius: number,
  startAndFinishAtOuterEdge = false
): RoutedPathResult {
  const outerRadius = Math.max(1, Math.abs(requestedOuterRadius));
  const remaining = paths
    .map(path => removeAdjacentDuplicates(path))
    .filter(path => path.length >= 2);

  if (remaining.length === 0) {
    return emptyResult();
  }

  const graph = new RouteGraph(outerRadius);
  const firstSelection = selectRadialStartPathPoint(
    remaining,
    outerRadius,
    false
  );
  const firstPath = remaining.splice(firstSelection.pathIndex, 1)[0];
  if (firstPath === undefined) {
    return emptyResult();
  }

  const firstWalk = walkEntirePathFrom(
    firstPath,
    firstSelection.pointIndex,
    outerRadius
  );
  const output = [...firstWalk];
  let currentNode = graph.addPolyline(firstWalk).endNode;
  let radialFrontier = pathRadialProfile(firstPath).centreRadius;
  let connectorCount = 0;
  let newConnectorDistance = 0;
  let crossingCount = 0;

  while (remaining.length > 0) {
    const shortest = graph.shortestPaths(currentNode);
    const choice = chooseNextRoute(
      graph,
      shortest,
      remaining,
      outerRadius,
      radialFrontier
    );
    const nextPath = remaining.splice(choice.pathIndex, 1)[0];
    if (nextPath === undefined) {
      continue;
    }

    const candidateWalk = walkEntirePathFrom(
      nextPath,
      choice.entryIndex,
      outerRadius
    );
    const candidateStart = candidateWalk[0];
    if (candidateStart === undefined) {
      continue;
    }

    appendPoints(output, graph.reconstructPath(shortest, choice.anchorNode).slice(1));
    const anchor = graph.point(choice.anchorNode);
    const connector = choice.mode === "outer"
      ? outerConnector(anchor, candidateStart, outerRadius)
      : sampledLine(anchor, candidateStart, outerRadius);

    appendPoints(output, connector.slice(1));
    graph.addPolyline(connector);
    appendPoints(output, candidateWalk.slice(1));
    currentNode = graph.addPolyline(candidateWalk).endNode;
    radialFrontier = Math.max(
      radialFrontier,
      pathRadialProfile(nextPath).centreRadius
    );

    connectorCount++;
    newConnectorDistance += choice.newDistance;
    crossingCount += choice.crossings;
  }

  const baseResult: RoutedPathResult = {
    points: removeAdjacentDuplicates(output),
    connectorCount,
    newConnectorDistance,
    crossingCount
  };

  if (!startAndFinishAtOuterEdge) {
    return baseResult;
  }

  const oriented = orientRouteFromAndBackToOuterEdge(baseResult.points, outerRadius);
  return {
    points: oriented.points,
    connectorCount: baseResult.connectorCount + oriented.connectorCount,
    newConnectorDistance:
      baseResult.newConnectorDistance + oriented.newConnectorDistance,
    crossingCount: baseResult.crossingCount
  };
}

function emptyResult(): RoutedPathResult {
  return {
    points: [],
    connectorCount: 0,
    newConnectorDistance: 0,
    crossingCount: 0
  };
}
