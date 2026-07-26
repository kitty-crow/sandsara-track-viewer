from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected text not found in {path}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


svg_path = ROOT / "src/webview/svgToTrack.ts"
replace_once(
    svg_path,
    '<input id="padding" type="range" min="0" max="20" step="0.5" value="4">\n        <span id="paddingValue" class="value">4.0%</span>\n      </div>',
    '<input id="padding" type="range" min="-100" max="20" step="0.5" value="4">\n        <span id="paddingValue" class="value">4.0%</span>\n      </div>\n      <span class="hint">Negative values enlarge the artwork and trim anything outside the circular drawing area.</span>',
)
replace_once(
    svg_path,
    'const fitKey = `${samplingKey}:${clamp(numberValue(padding, 4), 0, 20)}`;',
    'const fitKey = `${samplingKey}:${clamp(numberValue(padding, 4), -100, 20)}`;',
)
replace_once(
    svg_path,
    '        clamp(numberValue(padding, 4), 0, 20)\n',
    '        clamp(numberValue(padding, 4), -100, 20)\n',
)
replace_once(
    svg_path,
    '''  return paths.map(pathPoints => pathPoints.map(point => ({
    x: (point.x - centreX) * scale,
    y: -(point.y - centreY) * scale
  })));
}

function resamplePolyline''',
    '''  const fittedPaths = paths.map(pathPoints => pathPoints.map(point => ({
    x: (point.x - centreX) * scale,
    y: -(point.y - centreY) * scale
  })));

  return paddingPercent < 0
    ? clipPathsToCircle(fittedPaths, SANDSARA_RADIUS)
    : fittedPaths;
}

function clipPathsToCircle(
  paths: readonly (readonly Point[])[],
  radius: number
): Point[][] {
  const clippedPaths: Point[][] = [];
  const joinToleranceSquared = 1e-8;

  for (const pathPoints of paths) {
    let current: Point[] = [];

    for (let index = 1; index < pathPoints.length; index++) {
      const start = pathPoints[index - 1];
      const end = pathPoints[index];
      if (start === undefined || end === undefined) {
        continue;
      }

      const clipped = clipSegmentToCircle(start, end, radius);
      if (clipped === undefined) {
        if (current.length >= 2) {
          clippedPaths.push(current);
        }
        current = [];
        continue;
      }

      const [clippedStart, clippedEnd] = clipped;
      const previous = current.at(-1);
      if (
        previous === undefined ||
        squaredDistance(previous, clippedStart) > joinToleranceSquared
      ) {
        if (current.length >= 2) {
          clippedPaths.push(current);
        }
        current = [clippedStart];
      }

      const currentEnd = current.at(-1);
      if (
        currentEnd === undefined ||
        squaredDistance(currentEnd, clippedEnd) > joinToleranceSquared
      ) {
        current.push(clippedEnd);
      }
    }

    if (current.length >= 2) {
      clippedPaths.push(current);
    }
  }

  return clippedPaths;
}

function clipSegmentToCircle(
  start: Point,
  end: Point,
  radius: number
): readonly [Point, Point] | undefined {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const quadraticA = deltaX * deltaX + deltaY * deltaY;
  const radiusSquared = radius * radius;

  if (quadraticA <= 1e-12) {
    return start.x * start.x + start.y * start.y <= radiusSquared
      ? [start, end]
      : undefined;
  }

  const quadraticB = 2 * (start.x * deltaX + start.y * deltaY);
  const quadraticC = start.x * start.x + start.y * start.y - radiusSquared;
  const discriminant = quadraticB * quadraticB - 4 * quadraticA * quadraticC;
  const boundaries = [0, 1];

  if (discriminant >= 0) {
    const root = Math.sqrt(discriminant);
    const first = (-quadraticB - root) / (2 * quadraticA);
    const second = (-quadraticB + root) / (2 * quadraticA);
    if (first > 0 && first < 1) boundaries.push(first);
    if (second > 0 && second < 1) boundaries.push(second);
  }

  boundaries.sort((left, right) => left - right);
  for (let index = 1; index < boundaries.length; index++) {
    const intervalStart = boundaries[index - 1];
    const intervalEnd = boundaries[index];
    if (intervalStart === undefined || intervalEnd === undefined) {
      continue;
    }
    const midpoint = (intervalStart + intervalEnd) / 2;
    const midpointX = start.x + deltaX * midpoint;
    const midpointY = start.y + deltaY * midpoint;
    if (midpointX * midpointX + midpointY * midpointY <= radiusSquared + 1e-7) {
      return [
        {
          x: start.x + deltaX * intervalStart,
          y: start.y + deltaY * intervalStart
        },
        {
          x: start.x + deltaX * intervalEnd,
          y: start.y + deltaY * intervalEnd
        }
      ];
    }
  }

  return undefined;
}

function resamplePolyline''',
)

package_path = ROOT / "package.json"
package = json.loads(package_path.read_text(encoding="utf-8"))
package["version"] = "0.3.4"
package_path.write_text(json.dumps(package, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

lock_path = ROOT / "package-lock.json"
lock = json.loads(lock_path.read_text(encoding="utf-8"))
lock["version"] = "0.3.4"
lock["packages"][""]["version"] = "0.3.4"
lock_path.write_text(json.dumps(lock, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

changelog = ROOT / "CHANGELOG.md"
changelog.write_text(
    "## 0.3.4 - 2026-07-26\n\n"
    "- allows circular padding from -100% to +20%\n"
    "- enlarges artwork when padding is negative\n"
    "- clips overscanned line segments exactly at the circular drawing boundary before routing\n"
    "- splits strokes into valid in-circle paths when they leave and re-enter the canvas\n"
    "- reuses sampled SVG geometry when signed padding changes\n\n"
    + changelog.read_text(encoding="utf-8"),
    encoding="utf-8",
)

readme = ROOT / "README.md"
text = readme.read_text(encoding="utf-8")
needle = "SVG sampling, circular fitting and completed route results are cached independently, so changing only Sandsara point spacing reuses the route instead of calculating it again."
replacement = needle + " Circular padding accepts signed values from -100% to +20%; negative padding enlarges the centred artwork and clips excess geometry precisely at the circular drawing boundary before routing."
if needle not in text:
    raise SystemExit("README routing cache paragraph was not found")
readme.write_text(text.replace(needle, replacement, 1), encoding="utf-8")