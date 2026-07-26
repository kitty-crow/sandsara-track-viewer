export type I32 = number;
export type F64 = number;

const EPSILON_SQUARED: F64 = 1e-9;
const SCORE_EPSILON: F64 = 1e-6;
const MAX_START_POINTS: I32 = 32;
const MAX_PATH_ENTRY_POINTS: I32 = 18;
const MAX_SEGMENTS_PER_PATH: I32 = 128;
const MAX_GRAPH_NODES_PER_POLYLINE: I32 = 192;
const MAX_NEAREST_GRAPH_NODES: I32 = 2;
const MAX_OUTER_GRAPH_NODES: I32 = 6;
const SEGMENT_CELL_COUNT: I32 = 28;
const GRAPH_CELL_COUNT: I32 = 40;
const OUTER_ARC_STEP: F64 = 0.004363323129985824;
const LARGE_DISTANCE: F64 = 1e300;

let configured: I32 = 0;
let pathCountValue: I32 = 0;
let pointCountValue: I32 = 0;
let outerRadiusValue: F64 = 1;
let startFromOuterEdgeValue: I32 = 1;

let inputX: Array<F64> = new Array<F64>();
let inputY: Array<F64> = new Array<F64>();
let pathStart: Array<I32> = new Array<I32>();
let pathLength: Array<I32> = new Array<I32>();
let pathActive: Array<I32> = new Array<I32>();
let profileInner: Array<F64> = new Array<F64>();
let profileCentre: Array<F64> = new Array<F64>();
let profileOuter: Array<F64> = new Array<F64>();

let outputX: Array<F64> = new Array<F64>();
let outputY: Array<F64> = new Array<F64>();
let connectorCountValue: I32 = 0;
let newConnectorDistanceValue: F64 = 0;
let crossingCountValue: I32 = 0;

let segmentStartX: Array<F64> = new Array<F64>();
let segmentStartY: Array<F64> = new Array<F64>();
let segmentEndX: Array<F64> = new Array<F64>();
let segmentEndY: Array<F64> = new Array<F64>();
let segmentPath: Array<I32> = new Array<I32>();
let segmentMark: Array<I32> = new Array<I32>();
let segmentCellHead: Array<I32> = new Array<I32>();
let segmentCellEntrySegment: Array<I32> = new Array<I32>();
let segmentCellEntryNext: Array<I32> = new Array<I32>();
let segmentQuerySerial: I32 = 1;

let graphNodeX: Array<F64> = new Array<F64>();
let graphNodeY: Array<F64> = new Array<F64>();
let graphNodeEdgeHead: Array<I32> = new Array<I32>();
let graphNodeCellNext: Array<I32> = new Array<I32>();
let graphCellHead: Array<I32> = new Array<I32>();
let graphEdgeTo: Array<I32> = new Array<I32>();
let graphEdgeLength: Array<F64> = new Array<F64>();
let graphEdgeNext: Array<I32> = new Array<I32>();
let graphEdgePointStart: Array<I32> = new Array<I32>();
let graphEdgePointEnd: Array<I32> = new Array<I32>();
let graphEdgeReverse: Array<I32> = new Array<I32>();

let shortestDistance: Array<F64> = new Array<F64>();
let shortestPreviousNode: Array<I32> = new Array<I32>();
let shortestPreviousEdge: Array<I32> = new Array<I32>();
let shortestVisited: Array<I32> = new Array<I32>();
let heapNode: Array<I32> = new Array<I32>();
let heapDistance: Array<F64> = new Array<F64>();
let poppedNode: I32 = -1;
let poppedDistance: F64 = 0;
let reconstructedEdges: Array<I32> = new Array<I32>();

let nearestNodeIds: Array<I32> = new Array<I32>();
let nearestNodeDistances: Array<F64> = new Array<F64>();
let outerNodeIds: Array<I32> = new Array<I32>();
let outerNodeRadii: Array<F64> = new Array<F64>();

let localCount: I32 = 0;
let localPath: Array<I32> = new Array<I32>();
let localEntry: Array<I32> = new Array<I32>();
let localAnchor: Array<I32> = new Array<I32>();
let localMode: Array<I32> = new Array<I32>();
let localUsedDistance: Array<F64> = new Array<F64>();
let localNewDistance: Array<F64> = new Array<F64>();
let localExposure: Array<F64> = new Array<F64>();
let localEdgeDistance: Array<F64> = new Array<F64>();
let localRadialBacktrack: Array<F64> = new Array<F64>();
let localRadialAdvance: Array<F64> = new Array<F64>();

let bestSet: I32 = 0;
let bestPath: I32 = 0;
let bestEntry: I32 = 0;
let bestAnchor: I32 = 0;
let bestMode: I32 = 0;
let bestUsedDistance: F64 = 0;
let bestNewDistance: F64 = 0;
let bestExposure: F64 = 0;
let bestEdgeDistance: F64 = 0;
let bestCrossings: I32 = 0;
let bestRadialBacktrack: F64 = 0;
let bestRadialAdvance: F64 = 0;

let firstBestSet: I32 = 0;
let firstBestPath: I32 = 0;
let firstBestEntry: I32 = 0;
let firstBestCrossings: I32 = 0;
let firstBestCentre: F64 = 0;
let firstBestApproach: F64 = 0;
let firstBestSpan: F64 = 0;

let lastPolylineStart: I32 = 0;
let lastPolylineCount: I32 = 0;

export function routerVersion(): I32 {
  return 1;
}

export function routerConfigure(
  pathCount: I32,
  pointCount: I32,
  outerRadius: F64,
  startFromOuterEdge: I32
): I32 {
  if (pathCount < 0 || pointCount < 0 || outerRadius <= 0) {
    configured = 0;
    return -1;
  }

  pathCountValue = pathCount;
  pointCountValue = pointCount;
  outerRadiusValue = outerRadius;
  startFromOuterEdgeValue = startFromOuterEdge !== 0 ? 1 : 0;

  inputX = zeroF64(pointCountValue);
  inputY = zeroF64(pointCountValue);
  pathStart = zeroI32(pathCountValue);
  pathLength = zeroI32(pathCountValue);
  pathActive = zeroI32(pathCountValue);
  profileInner = zeroF64(pathCountValue);
  profileCentre = zeroF64(pathCountValue);
  profileOuter = zeroF64(pathCountValue);

  configured = 1;
  return 0;
}

export function routerSetPath(pathIndex: I32, start: I32, length: I32): I32 {
  if (configured === 0 || pathIndex < 0 || pathIndex >= pathCountValue ||
      start < 0 || length < 0 || start + length > pointCountValue) {
    return -1;
  }
  pathStart[pathIndex] = start;
  pathLength[pathIndex] = length;
  return 0;
}

export function routerSetPoint(pointIndex: I32, x: F64, y: F64): I32 {
  if (configured === 0 || pointIndex < 0 || pointIndex >= pointCountValue) {
    return -1;
  }
  inputX[pointIndex] = x;
  inputY[pointIndex] = y;
  return 0;
}

export function routerRun(): I32 {
  if (configured === 0) {
    return -1;
  }

  resetRunState();
  computeProfiles();
  buildUntouchedSegments();

  let remaining: I32 = 0;
  let pathIndex: I32 = 0;
  while (pathIndex < pathCountValue) {
    if (pathLength[pathIndex] >= 2) {
      pathActive[pathIndex] = 1;
      remaining += 1;
    }
    pathIndex += 1;
  }

  if (remaining === 0) {
    return 0;
  }

  selectFirstPath();
  if (firstBestSet === 0) {
    return -2;
  }

  appendPathWalk(firstBestPath, firstBestEntry);
  if (lastPolylineCount < 2) {
    return -3;
  }
  let currentNode: I32 = graphAddPolyline(lastPolylineStart, lastPolylineCount);
  pathActive[firstBestPath] = 0;
  remaining -= 1;
  let radialFrontier: F64 = profileCentre[firstBestPath];

  while (remaining > 0) {
    graphShortestPaths(currentNode);
    selectNextPath(radialFrontier);
    if (bestSet === 0) {
      return -4;
    }

    appendGraphPath(bestAnchor);
    const anchorX: F64 = graphNodeX[bestAnchor];
    const anchorY: F64 = graphNodeY[bestAnchor];
    const entryAbsolute: I32 = pathStart[bestPath] + bestEntry;
    const entryX: F64 = inputX[entryAbsolute];
    const entryY: F64 = inputY[entryAbsolute];

    const connectorStart: I32 = outputX.length > 0 ? outputX.length - 1 : 0;
    if (bestMode === 1) {
      appendOuterConnector(anchorX, anchorY, entryX, entryY);
    } else {
      appendSampledLine(anchorX, anchorY, entryX, entryY);
    }
    const connectorPointCount: I32 = outputX.length - connectorStart;
    if (connectorPointCount >= 2) {
      graphAddPolyline(connectorStart, connectorPointCount);
    }

    appendPathWalk(bestPath, bestEntry);
    if (lastPolylineCount >= 2) {
      currentNode = graphAddPolyline(lastPolylineStart, lastPolylineCount);
    }

    pathActive[bestPath] = 0;
    remaining -= 1;
    if (profileCentre[bestPath] > radialFrontier) {
      radialFrontier = profileCentre[bestPath];
    }
    connectorCountValue += 1;
    newConnectorDistanceValue += bestNewDistance;
    crossingCountValue += bestCrossings;
  }

  return outputX.length;
}

export function routerOutputCount(): I32 {
  return outputX.length;
}

export function routerOutputX(index: I32): F64 {
  if (index < 0 || index >= outputX.length) {
    return 0;
  }
  return outputX[index];
}

export function routerOutputY(index: I32): F64 {
  if (index < 0 || index >= outputY.length) {
    return 0;
  }
  return outputY[index];
}

export function routerConnectorCount(): I32 {
  return connectorCountValue;
}

export function routerNewConnectorDistance(): F64 {
  return newConnectorDistanceValue;
}

export function routerCrossingCount(): I32 {
  return crossingCountValue;
}

function resetRunState(): void {
  outputX = new Array<F64>();
  outputY = new Array<F64>();
  connectorCountValue = 0;
  newConnectorDistanceValue = 0;
  crossingCountValue = 0;

  segmentStartX = new Array<F64>();
  segmentStartY = new Array<F64>();
  segmentEndX = new Array<F64>();
  segmentEndY = new Array<F64>();
  segmentPath = new Array<I32>();
  segmentMark = new Array<I32>();
  segmentCellHead = filledI32(SEGMENT_CELL_COUNT * SEGMENT_CELL_COUNT, -1);
  segmentCellEntrySegment = new Array<I32>();
  segmentCellEntryNext = new Array<I32>();
  segmentQuerySerial = 1;

  graphNodeX = new Array<F64>();
  graphNodeY = new Array<F64>();
  graphNodeEdgeHead = new Array<I32>();
  graphNodeCellNext = new Array<I32>();
  graphCellHead = filledI32(GRAPH_CELL_COUNT * GRAPH_CELL_COUNT, -1);
  graphEdgeTo = new Array<I32>();
  graphEdgeLength = new Array<F64>();
  graphEdgeNext = new Array<I32>();
  graphEdgePointStart = new Array<I32>();
  graphEdgePointEnd = new Array<I32>();
  graphEdgeReverse = new Array<I32>();

  shortestDistance = new Array<F64>();
  shortestPreviousNode = new Array<I32>();
  shortestPreviousEdge = new Array<I32>();
  shortestVisited = new Array<I32>();
  heapNode = new Array<I32>();
  heapDistance = new Array<F64>();
  reconstructedEdges = new Array<I32>();

  nearestNodeIds = zeroI32(MAX_OUTER_GRAPH_NODES);
  nearestNodeDistances = zeroF64(MAX_OUTER_GRAPH_NODES);
  outerNodeIds = zeroI32(MAX_OUTER_GRAPH_NODES);
  outerNodeRadii = zeroF64(MAX_OUTER_GRAPH_NODES);

  localPath = zeroI32(3);
  localEntry = zeroI32(3);
  localAnchor = zeroI32(3);
  localMode = zeroI32(3);
  localUsedDistance = zeroF64(3);
  localNewDistance = zeroF64(3);
  localExposure = zeroF64(3);
  localEdgeDistance = zeroF64(3);
  localRadialBacktrack = zeroF64(3);
  localRadialAdvance = zeroF64(3);

  bestSet = 0;
  firstBestSet = 0;
}

function computeProfiles(): void {
  let pathIndex: I32 = 0;
  while (pathIndex < pathCountValue) {
    const start: I32 = pathStart[pathIndex];
    const length: I32 = pathLength[pathIndex];
    if (length <= 0) {
      profileInner[pathIndex] = 0;
      profileCentre[pathIndex] = 0;
      profileOuter[pathIndex] = 0;
      pathIndex += 1;
      continue;
    }

    let inner: F64 = LARGE_DISTANCE;
    let outer: F64 = 0;
    let total: F64 = 0;
    let offset: I32 = 0;
    while (offset < length) {
      const absolute: I32 = start + offset;
      const radius: F64 = radiusOf(inputX[absolute], inputY[absolute]);
      if (radius < inner) inner = radius;
      if (radius > outer) outer = radius;
      total += radius;
      offset += 1;
    }
    profileInner[pathIndex] = inner === LARGE_DISTANCE ? 0 : inner;
    profileCentre[pathIndex] = total / length;
    profileOuter[pathIndex] = outer;
    pathIndex += 1;
  }
}

function buildUntouchedSegments(): void {
  let pathIndex: I32 = 0;
  while (pathIndex < pathCountValue) {
    const start: I32 = pathStart[pathIndex];
    const length: I32 = pathLength[pathIndex];
    if (length >= 2) {
      const step: I32 = routingStep(length, MAX_SEGMENTS_PER_PATH + 1);
      let previousOffset: I32 = 0;
      let offset: I32 = step;
      while (offset < length) {
        addUntouchedSegment(pathIndex, start + previousOffset, start + offset);
        previousOffset = offset;
        offset += step;
      }
      if (previousOffset !== length - 1) {
        addUntouchedSegment(pathIndex, start + previousOffset, start + length - 1);
      }
    }
    pathIndex += 1;
  }
}

function addUntouchedSegment(pathIndex: I32, firstIndex: I32, secondIndex: I32): void {
  const startX: F64 = inputX[firstIndex];
  const startY: F64 = inputY[firstIndex];
  const endX: F64 = inputX[secondIndex];
  const endY: F64 = inputY[secondIndex];
  if (squaredDistanceValues(startX, startY, endX, endY) <= EPSILON_SQUARED) {
    return;
  }

  const segmentId: I32 = segmentPath.length;
  segmentStartX.push(startX);
  segmentStartY.push(startY);
  segmentEndX.push(endX);
  segmentEndY.push(endY);
  segmentPath.push(pathIndex);
  segmentMark.push(0);

  const minimumX: I32 = segmentCellX(startX < endX ? startX : endX);
  const maximumX: I32 = segmentCellX(startX > endX ? startX : endX);
  const minimumY: I32 = segmentCellY(startY < endY ? startY : endY);
  const maximumY: I32 = segmentCellY(startY > endY ? startY : endY);
  let x: I32 = minimumX;
  while (x <= maximumX) {
    let y: I32 = minimumY;
    while (y <= maximumY) {
      const cell: I32 = y * SEGMENT_CELL_COUNT + x;
      const entry: I32 = segmentCellEntrySegment.length;
      segmentCellEntrySegment.push(segmentId);
      segmentCellEntryNext.push(segmentCellHead[cell]);
      segmentCellHead[cell] = entry;
      y += 1;
    }
    x += 1;
  }
}

function selectFirstPath(): void {
  firstBestSet = 0;
  let pathIndex: I32 = 0;
  while (pathIndex < pathCountValue) {
    if (pathActive[pathIndex] !== 0) {
      const length: I32 = pathLength[pathIndex];
      const step: I32 = routingStep(length, MAX_START_POINTS);
      let entry: I32 = 0;
      while (entry < length) {
        considerFirstEntry(pathIndex, entry);
        entry += step;
      }
      if ((length - 1) % step !== 0) {
        considerFirstEntry(pathIndex, length - 1);
      }
    }
    pathIndex += 1;
  }
}

function considerFirstEntry(pathIndex: I32, entry: I32): void {
  const absolute: I32 = pathStart[pathIndex] + entry;
  const x: F64 = inputX[absolute];
  const y: F64 = inputY[absolute];
  let crossings: I32 = 0;
  let approach: F64 = -radiusOf(x, y);
  if (startFromOuterEdgeValue !== 0) {
    const radius: F64 = radiusOf(x, y);
    let edgeX: F64 = -outerRadiusValue;
    let edgeY: F64 = 0;
    if (radius > 1e-9) {
      const scale: F64 = outerRadiusValue / radius;
      edgeX = x * scale;
      edgeY = y * scale;
    }
    crossings = countCrossings(edgeX, edgeY, x, y, pathIndex);
    approach = distanceValues(edgeX, edgeY, x, y);
  }

  const centre: F64 = profileCentre[pathIndex];
  const span: F64 = profileOuter[pathIndex] - profileInner[pathIndex];
  if (firstBestSet === 0 || firstScoreBetter(crossings, centre, approach, span)) {
    firstBestSet = 1;
    firstBestPath = pathIndex;
    firstBestEntry = entry;
    firstBestCrossings = crossings;
    firstBestCentre = centre;
    firstBestApproach = approach;
    firstBestSpan = span;
  }
}

function firstScoreBetter(crossings: I32, centre: F64, approach: F64, span: F64): boolean {
  if (crossings !== firstBestCrossings) return crossings < firstBestCrossings;
  if (different(centre, firstBestCentre)) return centre < firstBestCentre;
  if (different(approach, firstBestApproach)) return approach < firstBestApproach;
  if (different(span, firstBestSpan)) return span < firstBestSpan;
  return false;
}

function selectNextPath(radialFrontier: F64): void {
  bestSet = 0;
  findOuterGraphNodes(MAX_OUTER_GRAPH_NODES);

  let pathIndex: I32 = 0;
  while (pathIndex < pathCountValue) {
    if (pathActive[pathIndex] !== 0) {
      const radialBacktrack: F64 = radialFrontier > profileOuter[pathIndex]
        ? radialFrontier - profileOuter[pathIndex]
        : 0;
      const radialAdvance: F64 = profileCentre[pathIndex] > radialFrontier
        ? profileCentre[pathIndex] - radialFrontier
        : 0;

      collectDirectOptions(pathIndex, radialBacktrack, radialAdvance);
      evaluateLocalOptions();
      collectOuterOptions(pathIndex, radialBacktrack, radialAdvance);
      evaluateLocalOptions();
    }
    pathIndex += 1;
  }

  if (bestSet === 0) {
    pathIndex = 0;
    while (pathIndex < pathCountValue) {
      if (pathActive[pathIndex] !== 0) {
        bestSet = 1;
        bestPath = pathIndex;
        bestEntry = 0;
        bestAnchor = 0;
        bestMode = 0;
        bestUsedDistance = 0;
        bestNewDistance = 0;
        bestExposure = 0;
        bestEdgeDistance = 0;
        bestCrossings = 0;
        bestRadialBacktrack = 0;
        bestRadialAdvance = 0;
        return;
      }
      pathIndex += 1;
    }
  }
}

function collectDirectOptions(pathIndex: I32, radialBacktrack: F64, radialAdvance: F64): void {
  localCount = 0;
  const length: I32 = pathLength[pathIndex];
  const step: I32 = routingStep(length, MAX_PATH_ENTRY_POINTS);
  let entry: I32 = 0;
  while (entry < length) {
    collectDirectEntry(pathIndex, entry, radialBacktrack, radialAdvance);
    entry += step;
  }
  if ((length - 1) % step !== 0) {
    collectDirectEntry(pathIndex, length - 1, radialBacktrack, radialAdvance);
  }
}

function collectDirectEntry(pathIndex: I32, entry: I32, radialBacktrack: F64, radialAdvance: F64): void {
  const absolute: I32 = pathStart[pathIndex] + entry;
  const entryX: F64 = inputX[absolute];
  const entryY: F64 = inputY[absolute];
  findNearestGraphNodes(entryX, entryY, MAX_NEAREST_GRAPH_NODES);
  let index: I32 = 0;
  while (index < MAX_NEAREST_GRAPH_NODES) {
    const anchor: I32 = nearestNodeIds[index];
    if (anchor >= 0) {
      const anchorX: F64 = graphNodeX[anchor];
      const anchorY: F64 = graphNodeY[anchor];
      insertLocalOption(
        3,
        pathIndex,
        entry,
        anchor,
        0,
        shortestDistance[anchor],
        distanceValues(anchorX, anchorY, entryX, entryY),
        segmentExposure(anchorX, anchorY, entryX, entryY),
        0,
        radialBacktrack,
        radialAdvance
      );
    }
    index += 1;
  }
}

function collectOuterOptions(pathIndex: I32, radialBacktrack: F64, radialAdvance: F64): void {
  localCount = 0;
  const length: I32 = pathLength[pathIndex];
  const step: I32 = routingStep(length, MAX_PATH_ENTRY_POINTS);
  let firstEntry: I32 = -1;
  let secondEntry: I32 = -1;
  let firstRadius: F64 = -1;
  let secondRadius: F64 = -1;

  let entry: I32 = 0;
  while (entry < length) {
    const absolute: I32 = pathStart[pathIndex] + entry;
    const radius: F64 = radiusOf(inputX[absolute], inputY[absolute]);
    if (radius > firstRadius) {
      secondRadius = firstRadius;
      secondEntry = firstEntry;
      firstRadius = radius;
      firstEntry = entry;
    } else if (radius > secondRadius) {
      secondRadius = radius;
      secondEntry = entry;
    }
    entry += step;
  }
  if ((length - 1) % step !== 0) {
    entry = length - 1;
    const absolute: I32 = pathStart[pathIndex] + entry;
    const radius: F64 = radiusOf(inputX[absolute], inputY[absolute]);
    if (radius > firstRadius) {
      secondEntry = firstEntry;
      firstEntry = entry;
    } else if (radius > secondRadius) {
      secondEntry = entry;
    }
  }

  if (firstEntry >= 0) {
    collectOuterEntry(pathIndex, firstEntry, radialBacktrack, radialAdvance);
  }
  if (secondEntry >= 0 && secondEntry !== firstEntry) {
    collectOuterEntry(pathIndex, secondEntry, radialBacktrack, radialAdvance);
  }
}

function collectOuterEntry(pathIndex: I32, entry: I32, radialBacktrack: F64, radialAdvance: F64): void {
  const absolute: I32 = pathStart[pathIndex] + entry;
  const entryX: F64 = inputX[absolute];
  const entryY: F64 = inputY[absolute];
  let index: I32 = 0;
  while (index < MAX_OUTER_GRAPH_NODES) {
    const anchor: I32 = outerNodeIds[index];
    if (anchor >= 0) {
      const anchorX: F64 = graphNodeX[anchor];
      const anchorY: F64 = graphNodeY[anchor];
      const anchorRadius: F64 = radiusOf(anchorX, anchorY);
      const entryRadius: F64 = radiusOf(entryX, entryY);
      let edgeStartX: F64 = -outerRadiusValue;
      let edgeStartY: F64 = 0;
      let edgeEndX: F64 = -outerRadiusValue;
      let edgeEndY: F64 = 0;
      if (anchorRadius > 1e-9) {
        const scaleStart: F64 = outerRadiusValue / anchorRadius;
        edgeStartX = anchorX * scaleStart;
        edgeStartY = anchorY * scaleStart;
      }
      if (entryRadius > 1e-9) {
        const scaleEnd: F64 = outerRadiusValue / entryRadius;
        edgeEndX = entryX * scaleEnd;
        edgeEndY = entryY * scaleEnd;
      }
      const edgeDistance: F64 = outerRadiusValue * absoluteValue(shortestAngleDelta(
        Math.atan2(edgeStartY, edgeStartX),
        Math.atan2(edgeEndY, edgeEndX)
      ));
      insertLocalOption(
        2,
        pathIndex,
        entry,
        anchor,
        1,
        shortestDistance[anchor],
        distanceValues(anchorX, anchorY, edgeStartX, edgeStartY) +
          distanceValues(edgeEndX, edgeEndY, entryX, entryY),
        segmentExposure(anchorX, anchorY, edgeStartX, edgeStartY) +
          segmentExposure(edgeEndX, edgeEndY, entryX, entryY),
        edgeDistance,
        radialBacktrack,
        radialAdvance
      );
    }
    index += 1;
  }
}

function insertLocalOption(
  limit: I32,
  pathIndex: I32,
  entry: I32,
  anchor: I32,
  mode: I32,
  usedDistance: F64,
  newDistance: F64,
  exposure: F64,
  edgeDistance: F64,
  radialBacktrack: F64,
  radialAdvance: F64
): void {
  let position: I32 = 0;
  while (position < localCount && !baseScoreBetter(
    radialBacktrack,
    exposure,
    radialAdvance,
    newDistance,
    edgeDistance,
    usedDistance,
    position
  )) {
    position += 1;
  }
  if (position >= limit) {
    return;
  }

  let last: I32 = localCount < limit ? localCount : limit - 1;
  while (last > position) {
    localPath[last] = localPath[last - 1];
    localEntry[last] = localEntry[last - 1];
    localAnchor[last] = localAnchor[last - 1];
    localMode[last] = localMode[last - 1];
    localUsedDistance[last] = localUsedDistance[last - 1];
    localNewDistance[last] = localNewDistance[last - 1];
    localExposure[last] = localExposure[last - 1];
    localEdgeDistance[last] = localEdgeDistance[last - 1];
    localRadialBacktrack[last] = localRadialBacktrack[last - 1];
    localRadialAdvance[last] = localRadialAdvance[last - 1];
    last -= 1;
  }

  localPath[position] = pathIndex;
  localEntry[position] = entry;
  localAnchor[position] = anchor;
  localMode[position] = mode;
  localUsedDistance[position] = usedDistance;
  localNewDistance[position] = newDistance;
  localExposure[position] = exposure;
  localEdgeDistance[position] = edgeDistance;
  localRadialBacktrack[position] = radialBacktrack;
  localRadialAdvance[position] = radialAdvance;
  if (localCount < limit) localCount += 1;
}

function baseScoreBetter(
  radialBacktrack: F64,
  exposure: F64,
  radialAdvance: F64,
  newDistance: F64,
  edgeDistance: F64,
  usedDistance: F64,
  existing: I32
): boolean {
  if (different(radialBacktrack, localRadialBacktrack[existing])) {
    return radialBacktrack < localRadialBacktrack[existing];
  }
  if (different(exposure, localExposure[existing])) {
    return exposure < localExposure[existing];
  }
  if (different(radialAdvance, localRadialAdvance[existing])) {
    return radialAdvance < localRadialAdvance[existing];
  }
  if (different(newDistance, localNewDistance[existing])) {
    return newDistance < localNewDistance[existing];
  }
  const weightedEdge: F64 = edgeDistance * 0.02;
  const existingEdge: F64 = localEdgeDistance[existing] * 0.02;
  if (different(weightedEdge, existingEdge)) {
    return weightedEdge < existingEdge;
  }
  return usedDistance * 0.0005 < localUsedDistance[existing] * 0.0005;
}

function evaluateLocalOptions(): void {
  let index: I32 = 0;
  while (index < localCount) {
    const pathIndex: I32 = localPath[index];
    const entry: I32 = localEntry[index];
    const anchor: I32 = localAnchor[index];
    const mode: I32 = localMode[index];
    const absolute: I32 = pathStart[pathIndex] + entry;
    const entryX: F64 = inputX[absolute];
    const entryY: F64 = inputY[absolute];
    const anchorX: F64 = graphNodeX[anchor];
    const anchorY: F64 = graphNodeY[anchor];
    let crossings: I32 = 0;
    if (mode === 1) {
      const anchorRadius: F64 = radiusOf(anchorX, anchorY);
      const entryRadius: F64 = radiusOf(entryX, entryY);
      let edgeStartX: F64 = -outerRadiusValue;
      let edgeStartY: F64 = 0;
      let edgeEndX: F64 = -outerRadiusValue;
      let edgeEndY: F64 = 0;
      if (anchorRadius > 1e-9) {
        const scaleStart: F64 = outerRadiusValue / anchorRadius;
        edgeStartX = anchorX * scaleStart;
        edgeStartY = anchorY * scaleStart;
      }
      if (entryRadius > 1e-9) {
        const scaleEnd: F64 = outerRadiusValue / entryRadius;
        edgeEndX = entryX * scaleEnd;
        edgeEndY = entryY * scaleEnd;
      }
      crossings = countCrossings(anchorX, anchorY, edgeStartX, edgeStartY, pathIndex) +
        countCrossings(edgeEndX, edgeEndY, entryX, entryY, pathIndex);
    } else {
      crossings = countCrossings(anchorX, anchorY, entryX, entryY, pathIndex);
    }

    if (bestSet === 0 || globalScoreBetter(
      crossings,
      localRadialBacktrack[index],
      localExposure[index],
      localRadialAdvance[index],
      localNewDistance[index],
      localEdgeDistance[index],
      localUsedDistance[index]
    )) {
      bestSet = 1;
      bestPath = pathIndex;
      bestEntry = entry;
      bestAnchor = anchor;
      bestMode = mode;
      bestUsedDistance = localUsedDistance[index];
      bestNewDistance = localNewDistance[index];
      bestExposure = localExposure[index];
      bestEdgeDistance = localEdgeDistance[index];
      bestCrossings = crossings;
      bestRadialBacktrack = localRadialBacktrack[index];
      bestRadialAdvance = localRadialAdvance[index];
    }
    index += 1;
  }
}

function globalScoreBetter(
  crossings: I32,
  radialBacktrack: F64,
  exposure: F64,
  radialAdvance: F64,
  newDistance: F64,
  edgeDistance: F64,
  usedDistance: F64
): boolean {
  if (crossings !== bestCrossings) return crossings < bestCrossings;
  if (different(radialBacktrack, bestRadialBacktrack)) return radialBacktrack < bestRadialBacktrack;
  if (different(exposure, bestExposure)) return exposure < bestExposure;
  if (different(radialAdvance, bestRadialAdvance)) return radialAdvance < bestRadialAdvance;
  if (different(newDistance, bestNewDistance)) return newDistance < bestNewDistance;
  if (different(edgeDistance * 0.02, bestEdgeDistance * 0.02)) {
    return edgeDistance < bestEdgeDistance;
  }
  return usedDistance * 0.0005 < bestUsedDistance * 0.0005;
}

function appendPathWalk(pathIndex: I32, requestedEntry: I32): void {
  const start: I32 = pathStart[pathIndex];
  const length: I32 = pathLength[pathIndex];
  lastPolylineStart = outputX.length > 0 ? outputX.length - 1 : outputX.length;
  if (length <= 0) {
    lastPolylineCount = 0;
    return;
  }

  let entry: I32 = requestedEntry;
  if (entry < 0) entry = 0;
  if (entry >= length) entry = length - 1;

  const firstX: F64 = inputX[start];
  const firstY: F64 = inputY[start];
  const lastX: F64 = inputX[start + length - 1];
  const lastY: F64 = inputY[start + length - 1];
  const closureTolerance: F64 = outerRadiusValue * 1e-5 > 1e-6
    ? outerRadiusValue * 1e-5
    : 1e-6;
  const closed: I32 = squaredDistanceValues(firstX, firstY, lastX, lastY) <=
    closureTolerance * closureTolerance ? 1 : 0;

  if (closed !== 0 && length > 2) {
    const coreLength: I32 = length - 1;
    if (entry >= coreLength) entry = 0;
    let index: I32 = entry;
    while (index < coreLength) {
      appendOutput(inputX[start + index], inputY[start + index]);
      index += 1;
    }
    index = 0;
    while (index <= entry) {
      appendOutput(inputX[start + index], inputY[start + index]);
      index += 1;
    }
    lastPolylineCount = outputX.length - lastPolylineStart;
    return;
  }

  if (entry === 0) {
    let index: I32 = 0;
    while (index < length) {
      appendOutput(inputX[start + index], inputY[start + index]);
      index += 1;
    }
  } else if (entry === length - 1) {
    let index: I32 = length - 1;
    while (index >= 0) {
      appendOutput(inputX[start + index], inputY[start + index]);
      index -= 1;
    }
  } else {
    const leftLength: F64 = inputPolylineLength(start, 0, entry);
    const rightLength: F64 = inputPolylineLength(start, entry, length - 1);
    let index: I32 = 0;
    if (leftLength <= rightLength) {
      index = entry;
      while (index >= 0) {
        appendOutput(inputX[start + index], inputY[start + index]);
        index -= 1;
      }
      index = 1;
      while (index <= entry) {
        appendOutput(inputX[start + index], inputY[start + index]);
        index += 1;
      }
      index = entry + 1;
      while (index < length) {
        appendOutput(inputX[start + index], inputY[start + index]);
        index += 1;
      }
    } else {
      index = entry;
      while (index < length) {
        appendOutput(inputX[start + index], inputY[start + index]);
        index += 1;
      }
      index = length - 2;
      while (index >= entry) {
        appendOutput(inputX[start + index], inputY[start + index]);
        index -= 1;
      }
      index = entry - 1;
      while (index >= 0) {
        appendOutput(inputX[start + index], inputY[start + index]);
        index -= 1;
      }
    }
  }
  lastPolylineCount = outputX.length - lastPolylineStart;
}

function appendOutput(x: F64, y: F64): void {
  const length: I32 = outputX.length;
  if (length > 0 && squaredDistanceValues(outputX[length - 1], outputY[length - 1], x, y) <= EPSILON_SQUARED) {
    return;
  }
  outputX.push(x);
  outputY.push(y);
}

function appendSampledLine(startX: F64, startY: F64, endX: F64, endY: F64): void {
  const length: F64 = distanceValues(startX, startY, endX, endY);
  const stepLength: F64 = outerRadiusValue / 256 > 1 ? outerRadiusValue / 256 : 1;
  let steps: I32 = ceilToI32(length / stepLength);
  if (steps < 1) steps = 1;
  let step: I32 = 0;
  while (step <= steps) {
    const ratio: F64 = step / steps;
    appendOutput(
      startX + (endX - startX) * ratio,
      startY + (endY - startY) * ratio
    );
    step += 1;
  }
}

function appendOuterConnector(startX: F64, startY: F64, endX: F64, endY: F64): void {
  const startRadius: F64 = radiusOf(startX, startY);
  const endRadius: F64 = radiusOf(endX, endY);
  let edgeStartX: F64 = -outerRadiusValue;
  let edgeStartY: F64 = 0;
  let edgeEndX: F64 = -outerRadiusValue;
  let edgeEndY: F64 = 0;
  if (startRadius > 1e-9) {
    const startScale: F64 = outerRadiusValue / startRadius;
    edgeStartX = startX * startScale;
    edgeStartY = startY * startScale;
  }
  if (endRadius > 1e-9) {
    const endScale: F64 = outerRadiusValue / endRadius;
    edgeEndX = endX * endScale;
    edgeEndY = endY * endScale;
  }
  appendSampledLine(startX, startY, edgeStartX, edgeStartY);
  appendOuterArc(edgeStartX, edgeStartY, edgeEndX, edgeEndY);
  appendSampledLine(edgeEndX, edgeEndY, endX, endY);
}

function appendOuterArc(startX: F64, startY: F64, endX: F64, endY: F64): void {
  const startAngle: F64 = Math.atan2(startY, startX);
  const delta: F64 = shortestAngleDelta(startAngle, Math.atan2(endY, endX));
  let steps: I32 = ceilToI32(absoluteValue(delta) / OUTER_ARC_STEP);
  if (steps < 1) steps = 1;
  let step: I32 = 0;
  while (step <= steps) {
    const angle: F64 = startAngle + delta * step / steps;
    appendOutput(Math.cos(angle) * outerRadiusValue, Math.sin(angle) * outerRadiusValue);
    step += 1;
  }
}

function graphAddPolyline(startIndex: I32, count: I32): I32 {
  if (count <= 0) {
    return graphAddNode(0, 0);
  }
  const endIndex: I32 = startIndex + count - 1;
  const step: I32 = routingStep(count, MAX_GRAPH_NODES_PER_POLYLINE);
  let previousIndex: I32 = startIndex;
  let previousNode: I32 = graphAddNode(outputX[previousIndex], outputY[previousIndex]);
  let finalNode: I32 = previousNode;
  let relative: I32 = step;
  while (relative < count) {
    const currentIndex: I32 = startIndex + relative;
    finalNode = graphConnectRange(previousNode, previousIndex, currentIndex);
    previousNode = finalNode;
    previousIndex = currentIndex;
    relative += step;
  }
  if (previousIndex !== endIndex) {
    finalNode = graphConnectRange(previousNode, previousIndex, endIndex);
  }
  return finalNode;
}

function graphConnectRange(previousNode: I32, previousIndex: I32, currentIndex: I32): I32 {
  const currentNode: I32 = graphAddNode(outputX[currentIndex], outputY[currentIndex]);
  if (currentNode !== previousNode) {
    const length: F64 = outputPolylineLength(previousIndex, currentIndex);
    if (length > 0) {
      graphAddEdge(previousNode, currentNode, length, previousIndex, currentIndex, 0);
      graphAddEdge(currentNode, previousNode, length, previousIndex, currentIndex, 1);
    }
  }
  return currentNode;
}

function graphAddNode(x: F64, y: F64): I32 {
  const cellX: I32 = graphCellX(x);
  const cellY: I32 = graphCellY(y);
  const tolerance: F64 = outerRadiusValue * 1e-6 > 1e-5 ? outerRadiusValue * 1e-6 : 1e-5;
  const toleranceSquared: F64 = tolerance * tolerance;
  let nearbyX: I32 = cellX - 1;
  while (nearbyX <= cellX + 1) {
    if (nearbyX >= 0 && nearbyX < GRAPH_CELL_COUNT) {
      let nearbyY: I32 = cellY - 1;
      while (nearbyY <= cellY + 1) {
        if (nearbyY >= 0 && nearbyY < GRAPH_CELL_COUNT) {
          let node: I32 = graphCellHead[nearbyY * GRAPH_CELL_COUNT + nearbyX];
          while (node >= 0) {
            if (squaredDistanceValues(graphNodeX[node], graphNodeY[node], x, y) <= toleranceSquared) {
              return node;
            }
            node = graphNodeCellNext[node];
          }
        }
        nearbyY += 1;
      }
    }
    nearbyX += 1;
  }

  const nodeId: I32 = graphNodeX.length;
  graphNodeX.push(x);
  graphNodeY.push(y);
  graphNodeEdgeHead.push(-1);
  const cell: I32 = cellY * GRAPH_CELL_COUNT + cellX;
  graphNodeCellNext.push(graphCellHead[cell]);
  graphCellHead[cell] = nodeId;
  return nodeId;
}

function graphAddEdge(
  from: I32,
  to: I32,
  length: F64,
  pointStart: I32,
  pointEnd: I32,
  reverse: I32
): void {
  const edge: I32 = graphEdgeTo.length;
  graphEdgeTo.push(to);
  graphEdgeLength.push(length);
  graphEdgeNext.push(graphNodeEdgeHead[from]);
  graphEdgePointStart.push(pointStart);
  graphEdgePointEnd.push(pointEnd);
  graphEdgeReverse.push(reverse);
  graphNodeEdgeHead[from] = edge;
}

function graphShortestPaths(startNode: I32): void {
  const nodeCount: I32 = graphNodeX.length;
  shortestDistance = filledF64(nodeCount, LARGE_DISTANCE);
  shortestPreviousNode = filledI32(nodeCount, -1);
  shortestPreviousEdge = filledI32(nodeCount, -1);
  shortestVisited = zeroI32(nodeCount);
  heapNode = new Array<I32>();
  heapDistance = new Array<F64>();
  shortestDistance[startNode] = 0;
  heapPush(startNode, 0);

  while (heapNode.length > 0) {
    heapPop();
    const node: I32 = poppedNode;
    if (node < 0 || shortestVisited[node] !== 0) {
      continue;
    }
    shortestVisited[node] = 1;
    let edge: I32 = graphNodeEdgeHead[node];
    while (edge >= 0) {
      const to: I32 = graphEdgeTo[edge];
      const nextDistance: F64 = poppedDistance + graphEdgeLength[edge];
      if (nextDistance + 1e-9 < shortestDistance[to]) {
        shortestDistance[to] = nextDistance;
        shortestPreviousNode[to] = node;
        shortestPreviousEdge[to] = edge;
        heapPush(to, nextDistance);
      }
      edge = graphEdgeNext[edge];
    }
  }
}

function heapPush(node: I32, distance: F64): void {
  heapNode.push(node);
  heapDistance.push(distance);
  let index: I32 = heapNode.length - 1;
  while (index > 0) {
    const parent: I32 = (index - 1) >> 1;
    if (heapDistance[parent] <= distance) {
      break;
    }
    heapNode[index] = heapNode[parent];
    heapDistance[index] = heapDistance[parent];
    index = parent;
  }
  heapNode[index] = node;
  heapDistance[index] = distance;
}

function heapPop(): void {
  poppedNode = -1;
  poppedDistance = 0;
  const count: I32 = heapNode.length;
  if (count <= 0) return;

  const firstNode: I32 = heapNode[0];
  const firstDistance: F64 = heapDistance[0];
  const lastNode: I32 = heapNode[count - 1];
  const lastDistance: F64 = heapDistance[count - 1];
  heapNode.pop();
  heapDistance.pop();
  poppedNode = firstNode;
  poppedDistance = firstDistance;
  if (count === 1) return;

  let index: I32 = 0;
  const remaining: I32 = count - 1;
  while (true) {
    const left: I32 = index * 2 + 1;
    if (left >= remaining) break;
    const right: I32 = left + 1;
    let smallest: I32 = left;
    if (right < remaining && heapDistance[right] < heapDistance[left]) {
      smallest = right;
    }
    if (heapDistance[smallest] >= lastDistance) break;
    heapNode[index] = heapNode[smallest];
    heapDistance[index] = heapDistance[smallest];
    index = smallest;
  }
  heapNode[index] = lastNode;
  heapDistance[index] = lastDistance;
}

function appendGraphPath(targetNode: I32): void {
  reconstructedEdges = new Array<I32>();
  let cursor: I32 = targetNode;
  while (cursor >= 0 && shortestPreviousNode[cursor] >= 0) {
    const edge: I32 = shortestPreviousEdge[cursor];
    if (edge < 0) break;
    reconstructedEdges.push(edge);
    cursor = shortestPreviousNode[cursor];
  }

  let index: I32 = reconstructedEdges.length - 1;
  while (index >= 0) {
    appendGraphEdge(reconstructedEdges[index]);
    index -= 1;
  }
}

function appendGraphEdge(edge: I32): void {
  const start: I32 = graphEdgePointStart[edge];
  const end: I32 = graphEdgePointEnd[edge];
  if (graphEdgeReverse[edge] === 0) {
    let index: I32 = start + 1;
    while (index <= end) {
      appendOutput(outputX[index], outputY[index]);
      index += 1;
    }
  } else {
    let index: I32 = end - 1;
    while (index >= start) {
      appendOutput(outputX[index], outputY[index]);
      index -= 1;
    }
  }
}

function findNearestGraphNodes(x: F64, y: F64, limit: I32): void {
  let index: I32 = 0;
  while (index < MAX_OUTER_GRAPH_NODES) {
    nearestNodeIds[index] = -1;
    nearestNodeDistances[index] = LARGE_DISTANCE;
    index += 1;
  }

  let node: I32 = 0;
  while (node < graphNodeX.length) {
    const distanceSquared: F64 = squaredDistanceValues(graphNodeX[node], graphNodeY[node], x, y);
    let position: I32 = 0;
    while (position < limit && distanceSquared >= nearestNodeDistances[position]) {
      position += 1;
    }
    if (position < limit) {
      let shift: I32 = limit - 1;
      while (shift > position) {
        nearestNodeIds[shift] = nearestNodeIds[shift - 1];
        nearestNodeDistances[shift] = nearestNodeDistances[shift - 1];
        shift -= 1;
      }
      nearestNodeIds[position] = node;
      nearestNodeDistances[position] = distanceSquared;
    }
    node += 1;
  }
}

function findOuterGraphNodes(limit: I32): void {
  let index: I32 = 0;
  while (index < MAX_OUTER_GRAPH_NODES) {
    outerNodeIds[index] = -1;
    outerNodeRadii[index] = -1;
    index += 1;
  }

  let node: I32 = 0;
  while (node < graphNodeX.length) {
    const radius: F64 = radiusOf(graphNodeX[node], graphNodeY[node]);
    let position: I32 = 0;
    while (position < limit && radius <= outerNodeRadii[position]) {
      position += 1;
    }
    if (position < limit) {
      let shift: I32 = limit - 1;
      while (shift > position) {
        outerNodeIds[shift] = outerNodeIds[shift - 1];
        outerNodeRadii[shift] = outerNodeRadii[shift - 1];
        shift -= 1;
      }
      outerNodeIds[position] = node;
      outerNodeRadii[position] = radius;
    }
    node += 1;
  }
}

function countCrossings(
  startX: F64,
  startY: F64,
  endX: F64,
  endY: F64,
  excludedPath: I32
): I32 {
  if (squaredDistanceValues(startX, startY, endX, endY) <= EPSILON_SQUARED) {
    return 0;
  }

  segmentQuerySerial += 1;
  if (segmentQuerySerial > 2000000000) {
    let reset: I32 = 0;
    while (reset < segmentMark.length) {
      segmentMark[reset] = 0;
      reset += 1;
    }
    segmentQuerySerial = 1;
  }

  const minimumX: I32 = segmentCellX(startX < endX ? startX : endX);
  const maximumX: I32 = segmentCellX(startX > endX ? startX : endX);
  const minimumY: I32 = segmentCellY(startY < endY ? startY : endY);
  const maximumY: I32 = segmentCellY(startY > endY ? startY : endY);
  let crossings: I32 = 0;
  let x: I32 = minimumX;
  while (x <= maximumX) {
    let y: I32 = minimumY;
    while (y <= maximumY) {
      let entry: I32 = segmentCellHead[y * SEGMENT_CELL_COUNT + x];
      while (entry >= 0) {
        const segment: I32 = segmentCellEntrySegment[entry];
        if (segmentMark[segment] !== segmentQuerySerial) {
          segmentMark[segment] = segmentQuerySerial;
          const owner: I32 = segmentPath[segment];
          if (owner !== excludedPath && pathActive[owner] !== 0 && segmentsCross(
            startX,
            startY,
            endX,
            endY,
            segmentStartX[segment],
            segmentStartY[segment],
            segmentEndX[segment],
            segmentEndY[segment]
          )) {
            crossings += 1;
          }
        }
        entry = segmentCellEntryNext[entry];
      }
      y += 1;
    }
    x += 1;
  }
  return crossings;
}

function segmentsCross(
  firstStartX: F64,
  firstStartY: F64,
  firstEndX: F64,
  firstEndY: F64,
  secondStartX: F64,
  secondStartY: F64,
  secondEndX: F64,
  secondEndY: F64
): boolean {
  const denominator: F64 =
    (firstEndX - firstStartX) * (secondEndY - secondStartY) -
    (firstEndY - firstStartY) * (secondEndX - secondStartX);
  if (absoluteValue(denominator) < 1e-9) return false;
  const firstParameter: F64 = (
    (secondStartX - firstStartX) * (secondEndY - secondStartY) -
    (secondStartY - firstStartY) * (secondEndX - secondStartX)
  ) / denominator;
  const secondParameter: F64 = (
    (secondStartX - firstStartX) * (firstEndY - firstStartY) -
    (secondStartY - firstStartY) * (firstEndX - firstStartX)
  ) / denominator;
  const margin: F64 = 1e-5;
  return firstParameter > margin && firstParameter < 1 - margin &&
    secondParameter > margin && secondParameter < 1 - margin;
}

function segmentExposure(startX: F64, startY: F64, endX: F64, endY: F64): F64 {
  const samples: I32 = 12;
  const segmentLength: F64 = distanceValues(startX, startY, endX, endY);
  if (segmentLength <= 0) return 0;
  let total: F64 = 0;
  let sample: I32 = 0;
  while (sample <= samples) {
    const ratio: F64 = sample / samples;
    const x: F64 = startX + (endX - startX) * ratio;
    const y: F64 = startY + (endY - startY) * ratio;
    const inwardRaw: F64 = 1 - radiusOf(x, y) / outerRadiusValue;
    const inward: F64 = inwardRaw > 0 ? inwardRaw : 0;
    total += inward * inward;
    sample += 1;
  }
  return segmentLength * total / (samples + 1);
}

function inputPolylineLength(start: I32, firstOffset: I32, lastOffset: I32): F64 {
  let total: F64 = 0;
  let offset: I32 = firstOffset + 1;
  while (offset <= lastOffset) {
    total += distanceValues(
      inputX[start + offset - 1],
      inputY[start + offset - 1],
      inputX[start + offset],
      inputY[start + offset]
    );
    offset += 1;
  }
  return total;
}

function outputPolylineLength(firstIndex: I32, lastIndex: I32): F64 {
  let total: F64 = 0;
  let index: I32 = firstIndex + 1;
  while (index <= lastIndex) {
    total += distanceValues(
      outputX[index - 1],
      outputY[index - 1],
      outputX[index],
      outputY[index]
    );
    index += 1;
  }
  return total;
}

function segmentCellX(x: F64): I32 {
  return coordinateCell(x, SEGMENT_CELL_COUNT);
}

function segmentCellY(y: F64): I32 {
  return coordinateCell(y, SEGMENT_CELL_COUNT);
}

function graphCellX(x: F64): I32 {
  return coordinateCell(x, GRAPH_CELL_COUNT);
}

function graphCellY(y: F64): I32 {
  return coordinateCell(y, GRAPH_CELL_COUNT);
}

function coordinateCell(value: F64, count: I32): I32 {
  const normalised: F64 = (value + outerRadiusValue) / (outerRadiusValue * 2);
  let cell: I32 = floorToI32(normalised * count);
  if (cell < 0) cell = 0;
  if (cell >= count) cell = count - 1;
  return cell;
}

function routingStep(length: I32, maximum: I32): I32 {
  if (length <= maximum) return 1;
  return ceilToI32((length - 1) / (maximum - 1));
}

function shortestAngleDelta(start: F64, end: F64): F64 {
  let delta: F64 = end - start;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function distanceValues(firstX: F64, firstY: F64, secondX: F64, secondY: F64): F64 {
  const dx: F64 = firstX - secondX;
  const dy: F64 = firstY - secondY;
  return Math.sqrt(dx * dx + dy * dy);
}

function squaredDistanceValues(firstX: F64, firstY: F64, secondX: F64, secondY: F64): F64 {
  const dx: F64 = firstX - secondX;
  const dy: F64 = firstY - secondY;
  return dx * dx + dy * dy;
}

function radiusOf(x: F64, y: F64): F64 {
  return Math.sqrt(x * x + y * y);
}

function different(first: F64, second: F64): boolean {
  return absoluteValue(first - second) > SCORE_EPSILON;
}

function absoluteValue(value: F64): F64 {
  return value < 0 ? -value : value;
}

function ceilToI32(value: F64): I32 {
  return Math.ceil(value) as I32;
}

function floorToI32(value: F64): I32 {
  return Math.floor(value) as I32;
}

function zeroI32(length: I32): Array<I32> {
  const output: Array<I32> = new Array<I32>();
  let index: I32 = 0;
  while (index < length) {
    output.push(0);
    index += 1;
  }
  return output;
}

function zeroF64(length: I32): Array<F64> {
  const output: Array<F64> = new Array<F64>();
  let index: I32 = 0;
  while (index < length) {
    output.push(0);
    index += 1;
  }
  return output;
}

function filledI32(length: I32, value: I32): Array<I32> {
  const output: Array<I32> = new Array<I32>();
  let index: I32 = 0;
  while (index < length) {
    output.push(value);
    index += 1;
  }
  return output;
}

function filledF64(length: I32, value: F64): Array<F64> {
  const output: Array<F64> = new Array<F64>();
  let index: I32 = 0;
  while (index < length) {
    output.push(value);
    index += 1;
  }
  return output;
}
