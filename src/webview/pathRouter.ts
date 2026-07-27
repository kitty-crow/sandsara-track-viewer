import { PthGraph } from "./routeGraph";
import { pickNext } from "./routePlanner";
import {
  radProf,
  pickStart
} from "./radialRouting";
import {
  addPts,
  edgeJoin,
  edgePt,
  uniqPts,
  linePts,
  walkPth,
  type Pt
} from "./routingGeometry";

export type { Pt } from "./routingGeometry";

export interface PthRes {
  readonly points: Pt[];
  readonly connectorCount: number;
  readonly newConnectorDistance: number;
  readonly crossingCount: number;
}

/**
 * Joins disconnected drawing paths while treating every line already travelled
 * as reusable track. Crossing untouched geometry is avoided first, then the
 * drawing advances through radial bands from the centre towards the perimeter.
 */
export function joinPth(
  paths: readonly (readonly Pt[])[],
  requestedOuterRadius: number,
  startFromOuterEdge = true
): PthRes {
  const outerRadius = Math.max(1, Math.abs(requestedOuterRadius));
  const remaining = paths
    .map(path => uniqPts(path))
    .filter(path => path.length >= 2);

  if (remaining.length === 0) {
    return emptyResult();
  }

  const graph = new PthGraph(outerRadius);
  const firstSelection = pickStart(
    remaining,
    outerRadius,
    startFromOuterEdge
  );
  const firstPath = remaining.splice(firstSelection.pathIndex, 1)[0];
  if (firstPath === undefined) {
    return emptyResult();
  }

  const firstWalk = walkPth(
    firstPath,
    firstSelection.pointIndex,
    outerRadius
  );
  const output: Pt[] = [];
  const firstPoint = firstWalk[0];
  if (startFromOuterEdge && firstPoint !== undefined) {
    addPts(output, linePts(edgePt(firstPoint, outerRadius), firstPoint, outerRadius));
  }
  addPts(output, firstWalk);
  const firstGraph = graph.addPth(output);
  const startNode = firstGraph.startNode;
  let currentNode = firstGraph.endNode;
  let radialFrontier = radProf(firstPath).centreRadius;
  let connectorCount = 0;
  let newConnectorDistance = 0;
  let crossingCount = 0;

  while (remaining.length > 0) {
    const shortest = graph.shortPth(currentNode);
    const choice = pickNext(
      graph,
      shortest,
      remaining,
      outerRadius,
      radialFrontier,
      startFromOuterEdge
    );
    const nextPath = remaining.splice(choice.pathIndex, 1)[0];
    if (nextPath === undefined) {
      continue;
    }

    const candidateWalk = walkPth(
      nextPath,
      choice.entryIndex,
      outerRadius
    );
    const candidateStart = candidateWalk[0];
    if (candidateStart === undefined) {
      continue;
    }

    addPts(output, graph.tracePth(shortest, choice.anchorNode).slice(1));
    const anchor = graph.point(choice.anchorNode);
    const connector = choice.mode === "outer"
      ? edgeJoin(anchor, candidateStart, outerRadius)
      : linePts(anchor, candidateStart, outerRadius);

    addPts(output, connector.slice(1));
    graph.addPth(connector);
    addPts(output, candidateWalk.slice(1));
    currentNode = graph.addPth(candidateWalk).endNode;
    radialFrontier = startFromOuterEdge
      ? Math.min(radialFrontier, radProf(nextPath).centreRadius)
      : Math.max(radialFrontier, radProf(nextPath).centreRadius);

    connectorCount++;
    newConnectorDistance += choice.newDistance;
    crossingCount += choice.crossings;
  }

  if (startFromOuterEdge) {
    const shortest = graph.shortPth(currentNode);
    addPts(output, graph.tracePth(shortest, startNode).slice(1));
  }

  return {
    points: uniqPts(output),
    connectorCount,
    newConnectorDistance,
    crossingCount
  };
}

function emptyResult(): PthRes {
  return {
    points: [],
    connectorCount: 0,
    newConnectorDistance: 0,
    crossingCount: 0
  };
}
