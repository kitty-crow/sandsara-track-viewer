export interface TrackTextPoint {
  readonly x: number;
  readonly y: number;
}

export interface ParsedTrackText {
  readonly points: readonly TrackTextPoint[];
  readonly warnings: readonly string[];
}

export interface TrackBodyIssue {
  readonly line: number;
  readonly message: string;
}

export interface InspectedTrackBody {
  readonly points: readonly TrackTextPoint[];
  readonly issues: readonly TrackBodyIssue[];
}

export type TrackLineKind = "blank" | "comment" | "directive" | "point" | "coordinate" | "invalid";

const header = "@track sandsara/1";
const pointLine = /^\s*(\d+)\s*:\s*([+-]?\d+)\s*,\s*([+-]?\d+)\s*(?:#.*)?$/;
const coordinateLine = /^\s*([+-]?\d+)\s*,\s*([+-]?\d+)\s*(?:#.*)?$/;
const directiveLine = /^\s*@([a-z][a-z0-9-]*)\s+(.+?)\s*$/i;

export function formatTrackText(points: readonly TrackTextPoint[]): string {
  const width = Math.max(6, String(Math.max(0, points.length - 1)).length);
  const lines = [header, `@points ${points.length}`, ""];
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (point === undefined) throw new Error(`Missing point at index ${index}.`);
    lines.push(`${String(index).padStart(width, "0")}: ${point.x}, ${point.y}`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatTrackBody(points: readonly TrackTextPoint[]): string {
  const lines: string[] = [];
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (point === undefined) throw new Error(`Missing point at index ${index}.`);
    lines.push(`${point.x}, ${point.y}`);
  }
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

export function parseTrackText(source: string): ParsedTrackText {
  const points: TrackTextPoint[] = [];
  const warnings: string[] = [];
  const lines = normalisedLines(source);
  let declaredPoints: number | null = null;
  let formatSeen = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] ?? "";
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const directive = directiveLine.exec(line);
    if (directive !== null) {
      const name = (directive[1] ?? "").toLowerCase();
      const value = (directive[2] ?? "").trim();
      if (name === "track") {
        if (value !== "sandsara/1") throw new Error(`Line ${lineIndex + 1}: unsupported track format ${JSON.stringify(value)}.`);
        formatSeen = true;
      } else if (name === "points") {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Line ${lineIndex + 1}: @points must be a non-negative integer.`);
        declaredPoints = parsed;
      } else {
        warnings.push(`Line ${lineIndex + 1}: ignored unknown directive @${name}.`);
      }
      continue;
    }
    const match = pointLine.exec(line);
    if (match === null) throw new Error(`Line ${lineIndex + 1}: expected “index: x, y”.`);
    const index = Number(match[1] ?? "-1");
    if (index !== points.length) throw new Error(`Line ${lineIndex + 1}: expected point index ${points.length}, found ${index}.`);
    const x = coordinate(match[2] ?? "", "X", lineIndex + 1);
    const y = coordinate(match[3] ?? "", "Y", lineIndex + 1);
    points.push({ x, y });
  }

  if (points.length < 2) throw new Error("A Sandsara track must contain at least two points.");
  if (!formatSeen) warnings.push("The @track sandsara/1 header was omitted.");
  if (declaredPoints !== null && declaredPoints !== points.length) warnings.push(`@points declares ${declaredPoints}, but ${points.length} points were decoded.`);
  return { points, warnings };
}

export function inspectTrackBody(source: string, minimumPoints = 2): InspectedTrackBody {
  const points: TrackTextPoint[] = [];
  const issues: TrackBodyIssue[] = [];
  const lines = normalisedLines(source);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] ?? "";
    const number = lineIndex + 1;
    if (line.trim().length === 0) {
      issues.push({ line: number, message: "expected “x, y”" });
      continue;
    }
    const match = coordinateLine.exec(line);
    if (match === null) {
      issues.push({ line: number, message: "expected “x, y”" });
      continue;
    }
    const x = Number(match[1] ?? "");
    const y = Number(match[2] ?? "");
    const faults: string[] = [];
    if (!Number.isInteger(x)) faults.push("X must be an integer");
    else if (x < -32_768 || x > 32_767) faults.push("X is outside the signed 16-bit range");
    if (!Number.isInteger(y)) faults.push("Y must be an integer");
    else if (y < -32_768 || y > 32_767) faults.push("Y is outside the signed 16-bit range");
    if (faults.length > 0) {
      issues.push({ line: number, message: faults.join("; ") });
      continue;
    }
    points.push({ x, y });
  }

  if (issues.length === 0 && points.length < minimumPoints) issues.push({ line: 0, message: `a track must contain at least ${minimumPoints} points` });
  return { points, issues };
}

export function parseTrackBody(source: string): ParsedTrackText {
  const inspected = inspectTrackBody(source);
  if (inspected.issues.length > 0) throw new Error(formatTrackIssues(inspected.issues));
  return { points: inspected.points, warnings: [] };
}

export function formatTrackIssues(issues: readonly TrackBodyIssue[]): string {
  const shown = issues.slice(0, 5).map(issue => issue.line > 0 ? `Line ${issue.line}: ${issue.message}.` : `${capitalise(issue.message)}.`);
  if (issues.length > shown.length) shown.push(`${issues.length - shown.length} more invalid line${issues.length - shown.length === 1 ? "" : "s"}.`);
  return shown.join(" ");
}

export function classifyTrackLine(line: string): TrackLineKind {
  const trimmed = line.trim();
  if (trimmed.length === 0) return "blank";
  if (trimmed.startsWith("#")) return "comment";
  if (directiveLine.test(line)) return "directive";
  if (pointLine.test(line)) return "point";
  if (coordinateLine.test(line)) return "coordinate";
  return "invalid";
}

export function renderTrackTokens(source: string): string {
  return normalisedLines(source, false).map(renderTrackLine).join("\n");
}

export function renderTrackBodyTokens(source: string): string {
  return normalisedLines(source, false).map(renderTrackBodyLine).join("\n");
}

export function renderTrackLine(line: string): string {
  const kind = classifyTrackLine(line);
  if (kind === "blank") return "<span class=\"tok-line tok-blank\">&nbsp;</span>";
  if (kind === "comment") return `<span class="tok-line tok-comment">${escapeHtml(line)}</span>`;
  if (kind === "directive") {
    const match = directiveLine.exec(line);
    const name = escapeHtml(match?.[1] ?? "");
    const value = escapeHtml(match?.[2] ?? "");
    return `<span class="tok-line tok-directive"><span class="tok-keyword">@${name}</span> <span class="tok-value">${value}</span></span>`;
  }
  if (kind === "point") {
    const match = pointLine.exec(line);
    const index = escapeHtml(match?.[1] ?? "");
    const x = escapeHtml(match?.[2] ?? "");
    const y = escapeHtml(match?.[3] ?? "");
    return `<span class="tok-line tok-point"><span class="tok-index">${index}</span><span class="tok-punctuation">:</span> <span class="tok-number tok-x">${x}</span><span class="tok-punctuation">,</span> <span class="tok-number tok-y">${y}</span></span>`;
  }
  if (kind === "coordinate") return renderTrackBodyLine(line);
  return `<span class="tok-line tok-invalid">${escapeHtml(line)}</span>`;
}

export function renderTrackBodyLine(line: string): string {
  const inspected = inspectTrackBody(line, 0);
  const match = coordinateLine.exec(line);
  if (match === null || inspected.issues.length > 0) return `<span class="tok-line tok-invalid">${escapeHtml(line)}</span>`;
  const x = escapeHtml(match[1] ?? "");
  const y = escapeHtml(match[2] ?? "");
  return `<span class="tok-line tok-coordinate"><span class="tok-number tok-x">${x}</span><span class="tok-punctuation">,</span> <span class="tok-number tok-y">${y}</span></span>`;
}

function normalisedLines(source: string, trimFinal = true): string[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  if (trimFinal && lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function coordinate(raw: string, axis: "X" | "Y", line: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`Line ${line}: ${axis} must be an integer.`);
  if (value < -32_768 || value > 32_767) throw new Error(`Line ${line}: ${axis} is outside the signed 16-bit range.`);
  return value;
}

function capitalise(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
