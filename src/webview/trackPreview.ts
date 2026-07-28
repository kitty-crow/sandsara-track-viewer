import type {
  FlatTrackPayload,
  TrackPreviewHostMessage,
  TrackPreviewWebviewMessage
} from "./types";
import {
  formatTrackText,
  parseTrackText,
  renderTrackTokens,
  type TrackTextPoint
} from "./trackText";

interface TrackMarkupGlobal {
  readonly __SANDSARA_TRACK_MARKUP__?: (source: string) => string;
}

const vscode = acquireVsCodeApi();
const app = document.getElementById("app");

if (app === null) throw new Error("The track preview root element is missing.");

app.innerHTML = `
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 16px;
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editor-background);
    font-family: var(--vscode-font-family);
  }
  h1 { margin: 0 0 4px; font-size: 1.3rem; }
  button {
    padding: 7px 11px;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    border: 0;
    cursor: pointer;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: 0.5; cursor: default; }
  .filename { margin-bottom: 12px; color: var(--vscode-descriptionForeground); }
  .view-tabs { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 14px; }
  .view-tabs button[aria-selected="true"] {
    outline: 2px solid var(--vscode-focusBorder);
    outline-offset: 1px;
  }
  .view-pane[hidden] { display: none; }
  .layout {
    display: grid;
    grid-template-columns: minmax(300px, 1fr) minmax(220px, 340px);
    gap: 18px;
  }
  canvas {
    display: block;
    width: 100%;
    aspect-ratio: 1;
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-editor-background);
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px 12px;
    margin: 0;
  }
  dt { color: var(--vscode-descriptionForeground); }
  dd { margin: 0; font-family: var(--vscode-editor-font-family); }
  .warnings {
    margin-top: 16px;
    padding: 8px 12px;
    color: var(--vscode-editorWarning-foreground);
    border: 1px solid var(--vscode-editorWarning-border);
  }
  .source-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
  .source-help { margin: 0 0 10px; color: var(--vscode-descriptionForeground); }
  .editor-shell {
    position: relative;
    min-height: 28rem;
    height: min(68vh, 54rem);
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-editor-background);
    overflow: hidden;
  }
  .editor-highlight,
  .editor-input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 12px 14px;
    overflow: auto;
    border: 0;
    white-space: pre;
    tab-size: 2;
    font: 13px/1.55 var(--vscode-editor-font-family, monospace);
  }
  .editor-highlight { pointer-events: none; color: var(--vscode-editor-foreground); }
  .editor-input {
    resize: none;
    color: transparent;
    caret-color: var(--vscode-editorCursor-foreground, var(--vscode-editor-foreground));
    background: transparent;
    outline: none;
  }
  .editor-input::selection { background: var(--vscode-editor-selectionBackground); }
  .source-status { margin: 9px 0 0; color: var(--vscode-descriptionForeground); }
  .source-status.error { color: var(--vscode-errorForeground, var(--vscode-editorError-foreground)); }
  .tok-line { display: block; min-height: 1.55em; }
  .tok-comment { color: var(--vscode-editorLineNumber-foreground); font-style: italic; }
  .tok-keyword { color: var(--vscode-symbolIcon-keywordForeground, #c586c0); font-weight: 700; }
  .tok-value { color: var(--vscode-symbolIcon-stringForeground, #ce9178); }
  .tok-index { color: var(--vscode-editorLineNumber-activeForeground, #858585); }
  .tok-number { color: var(--vscode-symbolIcon-numberForeground, #b5cea8); }
  .tok-punctuation { color: var(--vscode-editor-foreground); }
  .tok-invalid {
    color: var(--vscode-errorForeground, #f44747);
    text-decoration: underline wavy;
    text-decoration-color: var(--vscode-editorError-foreground, #f44747);
  }
  @media (max-width: 750px) {
    .layout { grid-template-columns: 1fr; }
    .editor-shell { min-height: 22rem; height: 58vh; }
  }
</style>
<h1>Sandsara track</h1>
<div id="filename" class="filename">Loading…</div>
<div class="view-tabs" role="tablist" aria-label="Track view">
  <button id="previewTab" type="button" role="tab" aria-selected="true" aria-controls="previewPane">Preview</button>
  <button id="sourceTab" type="button" role="tab" aria-selected="false" aria-controls="sourcePane">Track source</button>
</div>
<section id="previewPane" class="view-pane" role="tabpanel" aria-labelledby="previewTab">
  <div class="layout">
    <canvas id="preview" aria-label="Sandsara path preview"></canvas>
    <section>
      <dl id="statistics"></dl>
      <section id="warnings" class="warnings" hidden></section>
    </section>
  </div>
</section>
<section id="sourcePane" class="view-pane" role="tabpanel" aria-labelledby="sourceTab" hidden>
  <p class="source-help">Edit the decoded coordinates directly. Each line is <code>index: x, y</code>; coordinates must remain signed 16-bit integers.</p>
  <div class="source-actions">
    <button id="applySource" type="button" disabled>Apply to preview</button>
    <button id="saveSource" type="button" disabled>Save edited .bin</button>
    <button id="formatSource" type="button" disabled>Format source</button>
  </div>
  <div class="editor-shell">
    <pre id="sourceTokens" class="editor-highlight" aria-hidden="true"></pre>
    <textarea id="sourceInput" class="editor-input" aria-label="Editable Sandsara track source" spellcheck="false" wrap="off"></textarea>
  </div>
  <p id="sourceStatus" class="source-status" aria-live="polite">Load a track to edit it.</p>
</section>`;

const canvas = requiredElement<HTMLCanvasElement>("preview");
const filenameElement = requiredElement<HTMLElement>("filename");
const statisticsElement = requiredElement<HTMLElement>("statistics");
const warningsElement = requiredElement<HTMLElement>("warnings");
const previewTab = requiredElement<HTMLButtonElement>("previewTab");
const sourceTab = requiredElement<HTMLButtonElement>("sourceTab");
const previewPane = requiredElement<HTMLElement>("previewPane");
const sourcePane = requiredElement<HTMLElement>("sourcePane");
const sourceInput = requiredElement<HTMLTextAreaElement>("sourceInput");
const sourceTokens = requiredElement<HTMLElement>("sourceTokens");
const sourceStatus = requiredElement<HTMLElement>("sourceStatus");
const applySource = requiredElement<HTMLButtonElement>("applySource");
const saveSource = requiredElement<HTMLButtonElement>("saveSource");
const formatSource = requiredElement<HTMLButtonElement>("formatSource");

let currentPayload: FlatTrackPayload | null = null;
let parsedPoints: readonly TrackTextPoint[] | null = null;
let editTimer: number | null = null;

previewTab.addEventListener("click", () => selectPane(false));
sourceTab.addEventListener("click", () => selectPane(true));
sourceInput.addEventListener("input", scheduleSourceCheck);
sourceInput.addEventListener("scroll", syncSourceScroll);
applySource.addEventListener("click", () => commitSource(false));
saveSource.addEventListener("click", () => commitSource(true));
formatSource.addEventListener("click", formatSourceText);

window.addEventListener("message", (event: MessageEvent<TrackPreviewHostMessage>) => {
  if (event.data.type !== "track") return;
  currentPayload = event.data.payload;
  parsedPoints = pointsFromFlat(currentPayload.points);
  sourceInput.value = formatTrackText(parsedPoints);
  renderSourceTokens();
  validateSource();
  renderMetadata(currentPayload);
  draw(currentPayload);
});

new ResizeObserver(() => {
  if (currentPayload !== null) draw(currentPayload);
}).observe(canvas);

const readyMessage: TrackPreviewWebviewMessage = { type: "ready" };
vscode.postMessage(readyMessage);

function selectPane(source: boolean): void {
  previewTab.setAttribute("aria-selected", source ? "false" : "true");
  sourceTab.setAttribute("aria-selected", source ? "true" : "false");
  previewPane.hidden = source;
  sourcePane.hidden = !source;
  if (!source && currentPayload !== null) {
    const payload = currentPayload;
    window.setTimeout(() => draw(payload), 0);
  }
}

function scheduleSourceCheck(): void {
  renderSourceTokens();
  if (editTimer !== null) window.clearTimeout(editTimer);
  editTimer = window.setTimeout(validateSource, 120);
}

function validateSource(): void {
  editTimer = null;
  if (currentPayload === null) {
    parsedPoints = null;
    setSourceStatus("Load a track to edit it.", true);
    setSourceButtons(false);
    return;
  }

  try {
    const parsed = parseTrackText(sourceInput.value);
    parsedPoints = parsed.points;
    const note = parsed.warnings.length === 0
      ? `${parsed.points.length.toLocaleString("en-GB")} valid points in memory.`
      : `${parsed.points.length.toLocaleString("en-GB")} valid points. ${parsed.warnings.join(" ")}`;
    setSourceStatus(note, false);
    setSourceButtons(true);
  } catch (error: unknown) {
    parsedPoints = null;
    setSourceStatus(errorMessage(error), true);
    setSourceButtons(false);
  }
}

function commitSource(save: boolean): void {
  validateSource();
  if (parsedPoints === null || currentPayload === null) return;

  const points = flatFromPoints(parsedPoints);
  const source = formatTrackText(parsedPoints);
  sourceInput.value = source;
  renderSourceTokens();
  const message: TrackPreviewWebviewMessage = save
    ? {
        type: "saveTrack",
        points,
        source,
        suggestedName: safeBinName(currentPayload.filename)
      }
    : { type: "editTrack", points, source };
  vscode.postMessage(message);
  setSourceStatus(save ? "Saving the edited track…" : "Applying the edited track…", false);
}

function formatSourceText(): void {
  validateSource();
  if (parsedPoints === null) return;
  sourceInput.value = formatTrackText(parsedPoints);
  renderSourceTokens();
  setSourceStatus("Track source formatted in memory.", false);
}

function renderSourceTokens(): void {
  const global = globalThis as unknown as TrackMarkupGlobal;
  const renderer = global.__SANDSARA_TRACK_MARKUP__;
  sourceTokens.innerHTML = renderer === undefined
    ? renderTrackTokens(sourceInput.value)
    : renderer(sourceInput.value);
  syncSourceScroll();
}

function syncSourceScroll(): void {
  sourceTokens.scrollTop = sourceInput.scrollTop;
  sourceTokens.scrollLeft = sourceInput.scrollLeft;
}

function setSourceButtons(enabled: boolean): void {
  applySource.disabled = !enabled;
  saveSource.disabled = !enabled;
  formatSource.disabled = !enabled;
}

function setSourceStatus(text: string, bad: boolean): void {
  sourceStatus.textContent = text;
  sourceStatus.classList.toggle("error", bad);
}

function renderMetadata(payload: FlatTrackPayload): void {
  filenameElement.textContent = payload.filename ?? "Sandsara track";
  const rows: ReadonlyArray<readonly [string, string]> = [
    ["File size", formatOptionalNumber(payload.byteLength, " bytes")],
    ["Points", payload.pointCount.toLocaleString("en-GB")],
    ["X range", formatRange(payload.minX, payload.maxX)],
    ["Y range", formatRange(payload.minY, payload.maxY)],
    ["Maximum radius", payload.maximumRadius === undefined ? "Unknown" : payload.maximumRadius.toFixed(2)]
  ];

  statisticsElement.replaceChildren(...rows.flatMap(([label, value]) => {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    return [term, description];
  }));

  const warnings = payload.warnings ?? [];
  warningsElement.hidden = warnings.length === 0;
  warningsElement.replaceChildren(...warnings.map(warning => {
    const paragraph = document.createElement("p");
    paragraph.textContent = warning;
    return paragraph;
  }));
}

function draw(payload: FlatTrackPayload): void {
  const context = canvas.getContext("2d");
  if (context === null) return;

  const ratio = window.devicePixelRatio || 1;
  const cssSize = Math.max(1, canvas.getBoundingClientRect().width);
  const size = Math.max(1, Math.floor(cssSize * ratio));
  canvas.width = size;
  canvas.height = size;

  const padding = 18 * ratio;
  const radius = size / 2 - padding;
  const centre = size / 2;
  const scale = radius / 32_768;
  const styles = getComputedStyle(document.body);
  const trackColour = styles.getPropertyValue("--sandsara-track-line").trim() ||
    styles.getPropertyValue("--vscode-editor-foreground").trim() || "#000000";

  context.clearRect(0, 0, size, size);
  context.strokeStyle = styles.getPropertyValue("--vscode-panel-border");
  context.lineWidth = Math.max(1, ratio);
  context.beginPath();
  context.arc(centre, centre, radius, 0, Math.PI * 2);
  context.stroke();

  const count = Math.floor(payload.points.length / 2);
  if (count < 1) return;
  const stride = Math.max(1, Math.ceil(count / 100_000));
  const firstX = payload.points[0];
  const firstY = payload.points[1];
  if (firstX === undefined || firstY === undefined) return;

  context.strokeStyle = trackColour;
  context.lineWidth = Math.max(1.4, ratio * 1.1);
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(centre + firstX * scale, centre - firstY * scale);

  for (let pointIndex = stride; pointIndex < count; pointIndex += stride) {
    const x = payload.points[pointIndex * 2];
    const y = payload.points[pointIndex * 2 + 1];
    if (x !== undefined && y !== undefined) context.lineTo(centre + x * scale, centre - y * scale);
  }
  const finalX = payload.points.at(-2);
  const finalY = payload.points.at(-1);
  if (finalX !== undefined && finalY !== undefined) context.lineTo(centre + finalX * scale, centre - finalY * scale);
  context.stroke();

  drawMarker(context, centre, scale, firstX, firstY, "--vscode-charts-green", ratio);
  if (finalX !== undefined && finalY !== undefined) {
    drawMarker(context, centre, scale, finalX, finalY, "--vscode-charts-red", ratio);
  }
}

function drawMarker(
  context: CanvasRenderingContext2D,
  centre: number,
  scale: number,
  rawX: number,
  rawY: number,
  colourVariable: string,
  ratio: number
): void {
  const styles = getComputedStyle(document.body);
  context.fillStyle = styles.getPropertyValue(colourVariable);
  context.beginPath();
  context.arc(centre + rawX * scale, centre - rawY * scale, 4 * ratio, 0, Math.PI * 2);
  context.fill();
}

function pointsFromFlat(values: readonly number[]): TrackTextPoint[] {
  const points: TrackTextPoint[] = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    const x = values[index];
    const y = values[index + 1];
    if (x !== undefined && y !== undefined) points.push({ x, y });
  }
  return points;
}

function flatFromPoints(points: readonly TrackTextPoint[]): number[] {
  return points.flatMap(point => [point.x, point.y]);
}

function safeBinName(filename: string | undefined): string {
  const base = (filename ?? "Sandsara-trackNumber-edited.bin").replace(/\.bin$/i, "");
  return `${base}-edited.bin`;
}

function formatOptionalNumber(value: number | undefined, suffix: string): string {
  return value === undefined ? "Unknown" : `${value.toLocaleString("en-GB")}${suffix}`;
}

function formatRange(minimum: number | undefined, maximum: number | undefined): string {
  return minimum === undefined || maximum === undefined ? "Unknown" : `${minimum} to ${maximum}`;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing webview element: ${id}`);
  return element as T;
}
