import { readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const root = process.cwd();

async function read(path) {
  return readFile(join(root, path), "utf8");
}

async function write(path, text) {
  await writeFile(join(root, path), text, "utf8");
}

function swap(text, oldText, newText, label) {
  if (text.includes(newText)) return text;
  if (!text.includes(oldText)) throw new Error(`Missing ${label}`);
  return text.replace(oldText, newText);
}

async function walk(dir) {
  const out = [];
  for (const ent of await readdir(join(root, dir), { withFileTypes: true })) {
    if ([".git", "baguette", "build", "dist", "node_modules"].includes(ent.name)) continue;
    const rel = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...await walk(rel));
    else if ([".ts", ".mts", ".json"].includes(extname(ent.name))) out.push(rel);
  }
  return out;
}

// Make outer-edge mode route and stream from the perimeter towards the centre.
{
  const path = "src/router-wasm/router.ts";
  let s = await read(path);
  s = swap(s,
    "let runCurrentNode: I32 = -1;",
    "let runCurrentNode: I32 = -1;\nlet runStartNode: I32 = -1;",
    "WASM start node state");
  s = swap(s, "return 3;", "return 4;", "WASM ABI version");
  s = swap(s,
    "  runCurrentNode = -1;\n\n  let pathIndex: I32 = 0;",
    "  runCurrentNode = -1;\n  runStartNode = -1;\n\n  let pathIndex: I32 = 0;",
    "WASM start node reset");
  s = swap(s,
`  if (firstBand !== secondBand) return firstBand < secondBand;
  if (different(profileAngle[first], profileAngle[second])) {
    return profileAngle[first] < profileAngle[second];
  }
  if (different(profileCentre[first], profileCentre[second])) {
    return profileCentre[first] < profileCentre[second];
  }
  if (different(profileInner[first], profileInner[second])) {
    return profileInner[first] < profileInner[second];
  }`,
`  if (firstBand !== secondBand) {
    return startFromOuterEdgeValue !== 0
      ? firstBand > secondBand
      : firstBand < secondBand;
  }
  if (different(profileAngle[first], profileAngle[second])) {
    return profileAngle[first] < profileAngle[second];
  }
  if (different(profileCentre[first], profileCentre[second])) {
    return startFromOuterEdgeValue !== 0
      ? profileCentre[first] > profileCentre[second]
      : profileCentre[first] < profileCentre[second];
  }
  if (different(profileInner[first], profileInner[second])) {
    return startFromOuterEdgeValue !== 0
      ? profileInner[first] > profileInner[second]
      : profileInner[first] < profileInner[second];
  }`,
    "outside-in radial order");
  s = swap(s,
`    appendPathWalk(firstPath, firstBestEntry);
    if (lastPolylineCount < 2) {
      return -3;
    }
    runCurrentNode = graphAddPolyline(lastPolylineStart, lastPolylineCount);
    pathActive[firstPath] = 0;
    runOrderIndex = 1;
    if (runOrderIndex >= routeOrder.length) {
      runState = 2;
    }
    return 1;`,
`    if (startFromOuterEdgeValue !== 0) {
      const absolute: I32 = pathStart[firstPath] + firstBestEntry;
      const x: F64 = inputX[absolute];
      const y: F64 = inputY[absolute];
      const radius: F64 = radiusOf(x, y);
      let edgeX: F64 = -outerRadiusValue;
      let edgeY: F64 = 0;
      if (radius > 1e-9) {
        const scale: F64 = outerRadiusValue / radius;
        edgeX = x * scale;
        edgeY = y * scale;
      }
      appendSampledLine(edgeX, edgeY, x, y);
    }
    appendPathWalk(firstPath, firstBestEntry);
    if (startFromOuterEdgeValue !== 0) {
      lastPolylineStart = 0;
      lastPolylineCount = outputX.length;
    }
    if (lastPolylineCount < 2) {
      return -3;
    }
    if (runStartNode < 0 && outputX.length > 0) {
      runStartNode = graphAddNode(outputX[0], outputY[0]);
    }
    runCurrentNode = graphAddPolyline(lastPolylineStart, lastPolylineCount);
    pathActive[firstPath] = 0;
    runOrderIndex = 1;
    if (runOrderIndex >= routeOrder.length) {
      finishOuterReturn();
      runState = 2;
    }
    return 1;`,
    "outer first progress chunk");
  s = swap(s,
`  runOrderIndex += 1;
  if (runOrderIndex >= routeOrder.length) {
    runState = 2;
  }
  return 1;`,
`  runOrderIndex += 1;
  if (runOrderIndex >= routeOrder.length) {
    finishOuterReturn();
    runState = 2;
  }
  return 1;`,
    "outer final return");
  s = swap(s,
`  runOrderIndex = completedPaths;
  runCurrentNode = -1;`,
`  runOrderIndex = completedPaths;
  runCurrentNode = -1;
  runStartNode = -1;`,
    "resume start node reset");
  s = swap(s,
`  if (lastPolylineCount < 2) {
    return 0;
  }
  runCurrentNode = graphAddPolyline(lastPolylineStart, lastPolylineCount);`,
`  if (lastPolylineCount < 2) {
    return 0;
  }
  if (runStartNode < 0) {
    runStartNode = graphAddNode(outputX[lastPolylineStart], outputY[lastPolylineStart]);
  }
  runCurrentNode = graphAddPolyline(lastPolylineStart, lastPolylineCount);`,
    "resume graph start");
  s = swap(s,
`function appendOuterConnector(startX: F64, startY: F64, endX: F64, endY: F64): void {`,
`function finishOuterReturn(): void {
  if (startFromOuterEdgeValue === 0 || runStartNode < 0 || runCurrentNode < 0) {
    return;
  }
  graphShortestPaths(runCurrentNode);
  if (runStartNode < shortestDistance.length && shortestDistance[runStartNode] < LARGE_DISTANCE) {
    appendGraphPath(runStartNode);
  }
}

function appendOuterConnector(startX: F64, startY: F64, endX: F64, endY: F64): void {`,
    "outer return helper");
  await write(path, s);
}

// Give the TypeScript fallback the same outside-in order and safe return.
{
  const path = "src/webview/radialRouting.ts";
  let s = await read(path);
  s = swap(s,
`      const score = [
        crossings,
        profile.centreRadius,
        approachDistance,
        profile.outerRadius - profile.innerRadius
      ];`,
`      const score = [
        crossings,
        startFromOuterEdge ? -profile.centreRadius : profile.centreRadius,
        approachDistance,
        profile.outerRadius - profile.innerRadius
      ];`,
    "fallback outer start score");
  await write(path, s);
}

{
  const path = "src/webview/routePlanner.ts";
  let s = await read(path);
  s = swap(s,
`  candidates: readonly (readonly RoutingPoint[])[],
  outerRadius: number,
  radialFrontier: number
): RouteOption {`,
`  candidates: readonly (readonly RoutingPoint[])[],
  outerRadius: number,
  radialFrontier: number,
  startFromOuterEdge = false
): RouteOption {`,
    "fallback route direction parameter");
  s = swap(s,
`    const radialBacktrack = Math.max(0, radialFrontier - profile.outerRadius);
    const radialAdvance = Math.max(0, profile.centreRadius - radialFrontier);`,
`    const radialBacktrack = startFromOuterEdge
      ? Math.max(0, profile.innerRadius - radialFrontier)
      : Math.max(0, radialFrontier - profile.outerRadius);
    const radialAdvance = startFromOuterEdge
      ? Math.max(0, radialFrontier - profile.centreRadius)
      : Math.max(0, profile.centreRadius - radialFrontier);`,
    "fallback radial direction score");
  await write(path, s);
}

{
  const path = "src/webview/pathRouter.ts";
  let s = await read(path);
  s = swap(s,
`  const firstWalk = walkEntirePathFrom(
    firstPath,
    firstSelection.pointIndex,
    outerRadius
  );
  const output = [...firstWalk];
  let currentNode = graph.addPolyline(firstWalk).endNode;
  let radialFrontier = pathRadialProfile(firstPath).centreRadius;`,
`  const firstWalk = walkEntirePathFrom(
    firstPath,
    firstSelection.pointIndex,
    outerRadius
  );
  const output: RoutingPoint[] = [];
  const firstPoint = firstWalk[0];
  if (startFromOuterEdge && firstPoint !== undefined) {
    appendPoints(output, sampledLine(pointOnOuterEdge(firstPoint, outerRadius), firstPoint, outerRadius));
  }
  appendPoints(output, firstWalk);
  const firstGraph = graph.addPolyline(output);
  const startNode = firstGraph.startNode;
  let currentNode = firstGraph.endNode;
  let radialFrontier = pathRadialProfile(firstPath).centreRadius;`,
    "fallback outer entry");
  s = swap(s,
`      outerRadius,
      radialFrontier
    );`,
`      outerRadius,
      radialFrontier,
      startFromOuterEdge
    );`,
    "fallback route direction call");
  s = swap(s,
`    radialFrontier = Math.max(
      radialFrontier,
      pathRadialProfile(nextPath).centreRadius
    );`,
`    radialFrontier = startFromOuterEdge
      ? Math.min(radialFrontier, pathRadialProfile(nextPath).centreRadius)
      : Math.max(radialFrontier, pathRadialProfile(nextPath).centreRadius);`,
    "fallback frontier update");
  s = swap(s,
`  return {
    points: removeAdjacentDuplicates(output),`,
`  if (startFromOuterEdge) {
    const shortest = graph.shortestPaths(currentNode);
    appendPoints(output, graph.reconstructPath(shortest, startNode).slice(1));
  }

  return {
    points: removeAdjacentDuplicates(output),`,
    "fallback safe return");
  s = swap(s,
`  outerConnector,
  removeAdjacentDuplicates,
  sampledLine,`,
`  outerConnector,
  pointOnOuterEdge,
  removeAdjacentDuplicates,
  sampledLine,`,
    "fallback edge point import");
  await write(path, s);
}

// The route now already starts and ends on the ring; do not add fake edge points in rendering.
{
  const path = "src/webview/svgToTrack.ts";
  let s = await read(path);
  s = swap(s,
`  let joinedPoints = ordered.points;
  if (edgeEntry.checked && joinedPoints.length > 0) {
    const first = joinedPoints[0];
    const last = joinedPoints.at(-1);
    if (first !== undefined && last !== undefined) {
      joinedPoints = [pointOnOuterEdge(first), ...joinedPoints, pointOnOuterEdge(last)];
    }
  }`,
`  const joinedPoints = ordered.points;`,
    "remove display-only edge points");
  await write(path, s);
}

// Increment the route cache/ABI because saved chunks now use the real outside-in order.
{
  const path = "src/webview/routerWorker.ts";
  let s = await read(path);
  s = swap(s, "exports.routerVersion() !== 3", "exports.routerVersion() !== 4", "worker ABI version");
  await write(path, s);
}
{
  const path = "src/webview/routerWorkerClient.ts";
  let s = await read(path);
  s = swap(s, "mix(3);", "mix(4);", "checkpoint ABI hash");
  s = swap(s, "router-v3-", "router-v4-", "checkpoint namespace");
  await write(path, s);
}

// Concise project vocabulary. Comments carry intent; identifiers carry mechanics.
const names = new Map([
  ["joinPathsByDrawingRoute", "joinPth"],
  ["RoutedPathResult", "PthRes"],
  ["RoutingPoint", "Pt"],
  ["pathRadialProfile", "radProf"],
  ["PathRadialProfile", "RadProf"],
  ["selectRadialStartPathPoint", "pickStart"],
  ["RadialStartSelection", "StartSel"],
  ["chooseNextRoute", "pickNext"],
  ["RouteOption", "RtOpt"],
  ["IndexedSegment", "Seg"],
  ["SegmentGrid", "SegGrid"],
  ["keepBestBaseOptions", "keepOpt"],
  ["compareBaseRoutes", "cmpOpt"],
  ["isBetterRoute", "betterOpt"],
  ["compareScores", "cmpScore"],
  ["countOuterCrossings", "countEdgeCross"],
  ["countCrossings", "countCross"],
  ["walkEntirePathFrom", "walkPth"],
  ["outermostPathPoint", "outerPt"],
  ["routingIndexes", "routeIdx"],
  ["outerConnector", "edgeJoin"],
  ["sampledLine", "linePts"],
  ["outerEdgeArc", "edgeArc"],
  ["pointOnOuterEdge", "edgePt"],
  ["segmentExposure", "segExposure"],
  ["segmentsCrossAwayFromEndpoints", "segCross"],
  ["shortestAngleDelta", "angleDiff"],
  ["pointRadius", "ptRad"],
  ["polylineLength", "pthLen"],
  ["appendPoints", "addPts"],
  ["removeAdjacentDuplicates", "uniqPts"],
  ["squaredDistance", "dist2"],
  ["clampInteger", "clampInt"],
  ["GraphEdge", "Edge"],
  ["GraphNode", "Node"],
  ["ShortestPaths", "ShortPth"],
  ["RouteGraph", "PthGraph"],
  ["addPolyline", "addPth"],
  ["shortestPaths", "shortPth"],
  ["reconstructPath", "tracePth"],
  ["nearestNodeIds", "nearIds"],
  ["outerNodeIds", "edgeIds"],
  ["addCellCandidates", "addCell"],
  ["MinHeap", "Heap"],
  ["MAX_GRAPH_NODES_PER_POLYLINE", "MAX_PTH_NODES"],
  ["GRAPH_CELL_COUNT", "GRID_SIZE"],
  ["mergeTolerance", "mergeTol"],
  ["WorkerRouteRequest", "WorkReq"],
  ["WorkerRouteProgress", "WorkProg"],
  ["WorkerRouteSuccess", "WorkDone"],
  ["WorkerRouteFailure", "WorkErr"],
  ["WorkerRouteResponse", "WorkMsg"],
  ["RoutingProgress", "RouteProg"],
  ["RoutedWorkerResult", "RouteRes"],
  ["StoredRouteCheckpoint", "SavedRoute"],
  ["PendingRoute", "Pending"],
  ["routePathsInWorker", "routePth"],
  ["cancelActiveRouting", "cancelRoute"],
  ["requestWorkerRoute", "askWorker"],
  ["ensureWorker", "getWorker"],
  ["handleWorkerMessage", "onWorkerMsg"],
  ["pointsFromCoordinates", "ptsFromCoords"],
  ["routeCheckpointKey", "routeKey"],
  ["chunksFromCheckpoint", "savedChunks"],
  ["queueCheckpointSave", "saveLater"],
  ["queueCheckpointDelete", "dropLater"],
  ["checkpointFromPending", "makeSaved"],
  ["loadCheckpoint", "loadSaved"],
  ["putCheckpoint", "putSaved"],
  ["deleteCheckpoint", "dropSaved"],
  ["checkpointDatabase", "routeDb"],
  ["CHECKPOINT_DATABASE", "DB_NAME"],
  ["CHECKPOINT_STORE", "DB_STORE"],
  ["CHECKPOINT_MAX_AGE_MS", "DB_MAX_AGE"],
  ["nextRequestId", "nextId"],
  ["routerWorker", "worker"],
  ["workerUnavailable", "workerBad"],
  ["checkpointDatabasePromise", "dbP"],
  ["checkpointWriteQueue", "writeQ"],
  ["pendingRoutes", "pending"],
  ["routerVersion", "rVer"],
  ["routerConfigure", "rCfg"],
  ["routerSetPath", "rSetPth"],
  ["routerSetPoint", "rSetPt"],
  ["routerBegin", "rBegin"],
  ["routerStep", "rStep"],
  ["routerResumeBegin", "rResume"],
  ["routerResumeChunkBegin", "rChunk"],
  ["routerResumePoint", "rPt"],
  ["routerResumeChunkEnd", "rChunkEnd"],
  ["routerIsComplete", "rDone"],
  ["routerCompletedPathCount", "rDoneCnt"],
  ["routerTotalPathCount", "rTotal"],
  ["routerRun", "rRun"],
  ["routerOutputCount", "rOutCnt"],
  ["routerOutputX", "rOutX"],
  ["routerOutputY", "rOutY"],
  ["routerConnectorCount", "rJoinCnt"],
  ["routerNewConnectorDistance", "rNewLen"],
  ["routerCrossingCount", "rCrossCnt"],
  ["resetRunState", "reset"],
  ["computeProfiles", "profilePth"],
  ["buildUntouchedSegments", "indexSeg"],
  ["buildRadialOrder", "sortPth"],
  ["radialOrderBefore", "beforePth"],
  ["addUntouchedSegment", "addUntouched"],
  ["selectFirstEntryForPath", "pickFirst"],
  ["considerFirstEntryForPath", "tryFirst"],
  ["firstEntryScoreBetter", "betterFirst"],
  ["selectConnectionToPath", "pickJoin"],
  ["considerConnectedEntries", "tryTouch"],
  ["considerConnectedEntry", "tryTouchAt"],
  ["considerDirectEntries", "tryDirect"],
  ["considerDirectEntry", "tryDirectAt"],
  ["considerOuterEntries", "tryEdge"],
  ["considerOuterEntry", "tryEdgeAt"],
  ["considerConnectionCandidate", "tryJoin"],
  ["connectionScoreBetter", "betterJoin"],
  ["connectionToleranceSquared", "joinTol2"],
  ["appendPathWalk", "addPthWalk"],
  ["appendOutput", "addOut"],
  ["appendSampledLine", "addLine"],
  ["appendOuterConnector", "addEdgeJoin"],
  ["appendOuterArc", "addEdgeArc"],
  ["graphAddPolyline", "graphAddPth"],
  ["graphConnectRange", "graphLinkRange"],
  ["graphAddNode", "graphAddPt"],
  ["graphAddEdge", "graphLink"],
  ["graphShortestPaths", "graphShort"],
  ["appendGraphPath", "addGraphPth"],
  ["appendGraphEdge", "addGraphEdge"],
  ["findNearestGraphNodes", "findNear"],
  ["findOuterGraphNodes", "findEdge"],
  ["finishOuterReturn", "finishEdge"],
  ["SandsaraDocument", "TrackDoc"],
  ["SandsaraEditorProvider", "TrackEditor"],
  ["EmptyToolsProvider", "ToolTree"],
  ["vectoriseImage", "vectorise"],
  ["convertSvgToTrack", "svgToTrack"],
  ["saveGeneratedTrack", "saveTrack"],
  ["defaultTrackUri", "defaultTrack"],
  ["tracksDirectoryUri", "trackDir"],
  ["createPreviewPayload", "previewData"],
  ["createStatusBarButton", "statusBtn"],
  ["configureWebview", "setWebview"],
  ["createWebviewHtml", "webviewHtml"],
  ["createErrorHtml", "errorHtml"],
  ["resolveInputFile", "pickFile"],
  ["imageMimeType", "imgMime"],
  ["siblingUri", "sibling"],
  ["displayName", "nameOf"],
  ["safeFilename", "safeName"],
  ["isMessageType", "isMsg"],
  ["toErrorMessage", "errMsg"],
  ["decodeSandsaraTrack", "decodeTrack"],
  ["encodeSandsaraTrack", "encodeTrack"],
  ["pointsFromFlatArray", "ptsFromFlat"],
  ["runTypeScript", "runTs"],
  ["compileRouterWasm", "buildWasm"],
  ["ensureBaguetteToolchain", "ensureBaguette"],
  ["copyRouterWasm", "copyWasm"],
  ["copyStaticSite", "copySite"],
  ["rewriteBrowserModuleSpecifiers", "fixImports"],
  ["withJavaScriptExtension", "jsExt"],
  ["isMissingPath", "isMissing"],
  ["assertNoAuthoredJavaScript", "checkNoJs"]
]);

const files = await walk(".");
for (const file of files) {
  let s = await read(file);
  const before = s;
  for (const [oldName, newName] of names) {
    s = s.replace(new RegExp(`\\b${oldName}\\b`, "g"), newName);
  }
  if (s !== before) await write(file, s);
}

// Release metadata and documentation.
{
  const path = "package.json";
  const pkg = JSON.parse(await read(path));
  pkg.version = "0.3.5";
  await write(path, `${JSON.stringify(pkg, null, 2)}\n`);
}
{
  const path = "package-lock.json";
  const lock = JSON.parse(await read(path));
  lock.version = "0.3.5";
  if (lock.packages?.[""]) lock.packages[""].version = "0.3.5";
  await write(path, `${JSON.stringify(lock, null, 2)}\n`);
}
{
  const path = "README.md";
  let s = await read(path);
  s = s.replace("Version **0.3.0**", "Version **0.3.5**");
  s = s.replace("Orders nested and radial artwork from the centre towards the perimeter", "Orders radial artwork inward or outward to match the selected start direction");
  s = s.replace("fixes an inner-to-outer radial sweep before tracing begins", "fixes a radial sweep matching the selected physical drawing direction before tracing begins");
  s = s.replace("Circular padding accepts signed values from -100% to +20%; negative padding enlarges the centred artwork and clips excess geometry precisely at the circular drawing boundary before routing.", "Overscan ranges from -1.00 to +1.00; positive values enlarge and clip artwork at the circular boundary, while negative values shrink it. Outer-edge mode calculates and streams the real route from outside to inside, then retraces travelled geometry back to its exact starting point on the ring.");
  await write(path, s);
}
{
  const path = "CHANGELOG.md";
  let s = await read(path);
  const note = `## 0.3.5\n\n- Calculate and stream outer-edge routes from the perimeter towards the centre.\n- Return to the exact starting ring point over the travelled route graph.\n- Replace verbose Java-style identifiers with concise project names such as \`joinPth\`; comments retain behavioural explanations.\n- Preserve the existing commit history.\n\n`;
  if (!s.includes("## 0.3.5")) s = `${note}${s}`;
  await write(path, s);
}

// Ensure the old verbose vocabulary cannot silently return.
const left = [];
for (const file of files) {
  const s = await read(file);
  for (const oldName of names.keys()) {
    if (new RegExp(`\\b${oldName}\\b`).test(s)) left.push(`${file}: ${oldName}`);
  }
}
if (left.length) throw new Error(`Verbose identifiers remain:\n${left.join("\n")}`);

console.log(`Refactored ${files.length} authored TypeScript/JSON files.`);
