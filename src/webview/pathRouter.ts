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

export interface PthProg extends PthRes {
  readonly completedPaths: number;
  readonly totalPaths: number;
}

/**
 * Joins disconnected drawing paths while treating every line already travelled
 * as reusable track. Crossing untouched geometry is avoided first, then the
 * drawing advances through radial bands in the selected direction.
 */
export function joinPth(
  paths: readonly (readonly Pt[])[],
  requestedOuterRadius: number,
  startFromOuterEdge = true,
  onProgress?: (progress: PthProg) => void
): PthRes {
  const outerRadius = Math.max(1, Math.abs(requestedOuterRadius));
  const remaining = paths
    .map(path => uniqPts(path))
    .filter(path => path.length >= 2);
  const totalPaths = remaining.length;

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

  report(
    onProgress,
    output,
    totalPaths - remaining.length,
    totalPaths,
    connectorCount,
    newConnectorDistance,
    crossingCount
  );

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

    report(
      onProgress,
      output,
      totalPaths - remaining.length,
      totalPaths,
      connectorCount,
      newConnectorDistance,
      crossingCount
    );
  }

  if (startFromOuterEdge) {
    const shortest = graph.shortPth(currentNode);
    addPts(output, graph.tracePth(shortest, startNode).slice(1));
    report(
      onProgress,
      output,
      totalPaths,
      totalPaths,
      connectorCount,
      newConnectorDistance,
      crossingCount
    );
  }

  return {
    points: uniqPts(output),
    connectorCount,
    newConnectorDistance,
    crossingCount
  };
}

function report(
  onProgress: ((progress: PthProg) => void) | undefined,
  points: readonly Pt[],
  completedPaths: number,
  totalPaths: number,
  connectorCount: number,
  newConnectorDistance: number,
  crossingCount: number
): void {
  onProgress?.({
    points: [...points],
    completedPaths,
    totalPaths,
    connectorCount,
    newConnectorDistance,
    crossingCount
  });
}

function emptyResult(): PthRes {
  return {
    points: [],
    connectorCount: 0,
    newConnectorDistance: 0,
    crossingCount: 0
  };
}
