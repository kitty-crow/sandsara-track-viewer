import { readFile } from "node:fs/promises";

interface RouterExports {
  routerVersion(): number;
  routerConfigure(pathCount: number, pointCount: number, outerRadius: number, startFromOuterEdge: number): number;
  routerSetPath(pathIndex: number, start: number, length: number): number;
  routerSetPoint(pointIndex: number, x: number, y: number): number;
  routerRun(): number;
  routerOutputCount(): number;
  routerOutputX(index: number): number;
  routerOutputY(index: number): number;
  routerCrossingCount(): number;
}

const bytes = await readFile("build/router-wasm/path-router.wasm");
const result = await WebAssembly.instantiate(bytes, {
    env: {
      abort: (_message: number, _filename: number, line: number, column: number): never => {
        throw new Error(`The WebAssembly router aborted at ${line}:${column}.`);
      }
    }
  });
const router = result.instance.exports as unknown as RouterExports;

if (router.routerVersion() !== 1) {
  throw new Error("Unexpected path router ABI version.");
}

const circle = (radius: number, count: number): Array<{ x: number; y: number }> =>
  Array.from({ length: count + 1 }, (_value, index) => {
    const angle = Math.PI * 2 * index / count;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });

const paths = [circle(22, 220), circle(4, 120), circle(12, 160)];
const starts: number[] = [];
let pointCount = 0;
for (const path of paths) {
  starts.push(pointCount);
  pointCount += path.length;
}

if (router.routerConfigure(paths.length, pointCount, 30, 0) !== 0) {
  throw new Error("Could not configure the WebAssembly router.");
}

let flatIndex = 0;
for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
  const path = paths[pathIndex]!;
  if (router.routerSetPath(pathIndex, starts[pathIndex]!, path.length) !== 0) {
    throw new Error("Could not configure a WebAssembly path.");
  }
  for (const point of path) {
    if (router.routerSetPoint(flatIndex++, point.x, point.y) !== 0) {
      throw new Error("Could not load a WebAssembly path point.");
    }
  }
}

const runResult = router.routerRun();
if (runResult <= 0 || router.routerOutputCount() !== runResult) {
  throw new Error(`The WebAssembly router returned an invalid point count: ${runResult}.`);
}
if (router.routerCrossingCount() !== 0) {
  throw new Error("The WebAssembly router crossed untouched concentric geometry.");
}

const radii = Array.from({ length: router.routerOutputCount() }, (_value, index) =>
  Math.hypot(router.routerOutputX(index), router.routerOutputY(index))
);

function firstRunNear(expected: number, tolerance = 0.35, runLength = 8): number {
  let run = 0;
  for (let index = 0; index < radii.length; index++) {
    if (Math.abs(radii[index]! - expected) <= tolerance) {
      run++;
      if (run >= runLength) return index - runLength + 1;
    } else {
      run = 0;
    }
  }
  return -1;
}

const inner = firstRunNear(4);
const middle = firstRunNear(12);
const outer = firstRunNear(22);
if (inner < 0 || middle < 0 || outer < 0 || !(inner < middle && middle < outer)) {
  throw new Error(`The WebAssembly router did not progress radially: ${inner}, ${middle}, ${outer}.`);
}

console.log(`Validated WebAssembly routing with ${runResult.toLocaleString("en-GB")} points.`);
