import type {
  FlatTrackPayload,
  TrackPreviewHostMessage,
  TrackPreviewWebviewMessage
} from "./types";
import {
  formatTrackBody,
  parseTrackBody,
  renderTrackBodyTokens,
  type TrackTextPoint
} from "./trackText";

interface TrackMarkupGlobal {
  readonly __SANDSARA_TRACK_MARKUP__?: (source: string) => string;
}

interface DirtyDetail {
  readonly dirty: boolean;
}

const vscode = acquireVsCodeApi();
const app = document.getElementById("app");

if (app === null) throw new Error("The track editor root element is missing.");

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
  body.source-busy,
  body.source-busy button,
  body.source-busy textarea { cursor: progress !important; }
  h1 { margin: 0 0 4px; font-size: 1.3rem; }
  button {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    border: 0;
    cursor: pointer;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: 0.5; cursor: default; }
  .filename { margin-bottom: 12px; color: var(--vscode-descriptionForeground); }
  .view-tabs { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 14px; }
  .view-tabs button { padding: 7px 11px; border-radius: 999px; }
  .view-tabs button[aria-selected="true"] {
    outline: 2px solid var(--vscode-focusBorder);
    outline-offset: 1px;
  }
  .view-pane[hidden],
  .editor-shell[hidden],
  .source-load[hidden] { display: none; }
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
  .source-help { margin: 0 0 10px; color: var(--vscode-descriptionForeground); }
  .source-meta {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 6px 12px;
    margin: 0 0 12px;
    padding: 10px 12px;
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    font: 13px/1.5 var(--vscode-editor-font-family, monospace);
  }
  .source-meta dt { color: var(--vscode-symbolIcon-keywordForeground, #c586c0); font-weight: 700; }
  .source-meta dd { color: var(--vscode-symbolIcon-stringForeground, #ce9178); }
  .source-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 10px;
  }
  .icon-button {
    position: relative;
    display: inline-grid;
    place-items: center;
    width: 2.55rem;
    height: 2.55rem;
    padding: 0;
    border-radius: 999px;
  }
  .icon-button svg {
    width: 1.15rem;
    height: 1.15rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.9;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .icon-button::after {
    content: attr(data-tip);
    position: absolute;
    z-index: 20;
    left: 50%;
    top: calc(100% + 0.45rem);
    max-width: 18rem;
    width: max-content;
    padding: 0.38rem 0.55rem;
    color: var(--vscode-editorWidget-foreground, var(--vscode-editor-foreground));
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
    border-radius: 0.35rem;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.18);
    font-size: 0.78rem;
    line-height: 1.3;
    text-align: left;
    transform: translate(-50%, -0.2rem);
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease, transform 120ms ease;
  }
  .icon-button:hover::after,
  .icon-button:focus-visible::after {
    opacity: 1;
    transform: translate(-50%, 0);
  }
  .source-load {
    display: grid;
    gap: 7px;
    margin: 4px 0 12px;
    padding: 10px 12px;
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  }
  .source-load-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    color: var(--vscode-descriptionForeground);
    font-size: 0.9rem;
  }
  .source-load progress {
    width: 100%;
    height: 0.7rem;
    accent-color: var(--vscode-progressBar-background, var(--vscode-button-background));
  }
  .editor-shell {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    min-height: 28rem;
    height: min(68vh, 54rem);
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-editor-background);
    overflow: hidden;
  }
  .line-gutter {
    min-width: 5.6rem;
    margin: 0;
    padding: 12px 10px;
    overflow: hidden;
    color: var(--vscode-editorLineNumber-foreground, #858585);
    background: var(--vscode-editorGutter-background, var(--vscode-editor-background));
    border-right: 1px solid var(--vscode-panel-border);
    text-align: right;
    user-select: none;
    font: 13px/1.55 var(--vscode-editor-font-family, monospace);
    white-space: pre;
  }
  .editor-code {
    position: relative;
    min-width: 0;
    min-height: 0;
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
    border: 0;
    white-space: pre;
    tab-size: 2;
    font: 13px/1.55 var(--vscode-editor-font-family, monospace);
  }
  .editor-highlight {
    z-index: 1;
    overflow: auto;
    pointer-events: none;
    color: var(--vscode-editor-foreground);
  }
  .editor-input {
    z-index: 2;
    resize: none;
    overflow: auto;
    color: rgba(0, 0, 0, 0.01);
    -webkit-text-fill-color: transparent;
    caret-color: var(--vscode-editorCursor-foreground, var(--vscode-editor-foreground));
    background: transparent;
    outline: none;
    cursor: text;
    user-select: text;
  }
  .editor-input::selection {
    background: var(--vscode-editor-selectionBackground, rgba(120, 160, 220, 0.45));
    -webkit-text-fill-color: transparent;
  }
  .source-status { margin: 9px 0 0; color: var(--vscode-descriptionForeground); }
  .source-status.error { color: var(--vscode-errorForeground, var(--vscode-editorError-foreground)); }
  .tok-number { color: var(--vscode-symbolIcon-numberForeground, #b5cea8); }
  .tok-x { color: var(--vscode-symbolIcon-numberForeground, #b5cea8); }
  .tok-y { color: var(--vscode-symbolIcon-stringForeground, #ce9178); }
  .tok-punctuation { color: var(--vscode-editor-foreground); }
  .tok-invalid {
    color: var(--vscode-errorForeground, #f44747);
    text-decoration: underline wavy;
    text-decoration-color: var(--vscode-editorError-foreground, #f44747);
  }
  @media (max-width: 750px) {
    .layout { grid-template-columns: 1fr; }
    .editor-shell { min-height: 22rem; height: 58vh; }
    .line-gutter { min-width: 4.8rem; }
  }
</style>
<h1>Sandsara track editor</h1>
<div id="filename" class="filename">Loading…</div>
<div class="view-tabs" role="tablist" aria-label="Track editor view">
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
  <p class="source-help">Edit one signed 16-bit <code>x, y</code> coordinate pair per line. The format, point count and line indices are calculated automatically.</p>
  <dl class="source-meta" aria-label="Calculated track metadata">
    <dt>@track</dt><dd>sandsara/1</dd>
    <dt>@points</dt><dd id="pointCount">0</dd>
  </dl>
  <div class="source-actions" role="toolbar" aria-label="Track source actions">
    <button id="applySource" class="icon-button" type="button" aria-label="Apply edits to preview" data-tip="Apply edits to the preview" title="Apply edits to the preview" disabled>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>
    </button>
    <button id="saveSource" class="icon-button" type="button" aria-label="Save edited .bin" data-tip="Encode and save the edited .bin" title="Encode and save the edited .bin" disabled>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/></svg>
    </button>
    <button id="resetSource" class="icon-button" type="button" aria-label="Reset to original file" data-tip="Reset every edit to the originally loaded file" title="Reset every edit to the originally loaded file" disabled>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v6h6"/></svg>
    </button>
    <button id="normaliseSource" class="icon-button" type="button" aria-label="Normalise coordinate spacing" data-tip="Normalise spacing and remove blank lines without changing coordinates" title="Normalise spacing and remove blank lines without changing coordinates" disabled>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M7 12h10M9 17h6"/></svg>
    </button>
  </div>
  <div id="sourceLoad" class="source-load" role="status" aria-live="polite" hidden>
    <div class="source-load-head">
      <span id="sourceLoadText">Preparing track source…</span>
      <span id="sourceLoadPercent">0%</span>
    </div>
    <progress id="sourceProgress" max="100" value="0" aria-labelledby="sourceLoadText"></progress>
  </div>
  <div id="editorShell" class="editor-shell" hidden>
    <pre id="lineNumbers" class="line-gutter" aria-hidden="true"></pre>
    <div class="editor-code">
      <pre id="sourceTokens" class="editor-highlight" aria-hidden="true"></pre>
      <textarea id="sourceInput" class="editor-input" aria-label="Editable Sandsara coordinates" spellcheck="false" wrap="off" disabled></textarea>
    </div>
  </div>
  <p id="sourceStatus" class="source-status" aria-live="polite">Load a track to edit it.</p>
</section>`;

const canvas = el<HTMLCanvasElement>("preview");
const filename = el<HTMLElement>("filename");
const stats = el<HTMLElement>("statistics");
const warnings = el<HTMLElement>("warnings");
const previewTab = el<HTMLButtonElement>("previewTab");
const sourceTab = el<HTMLButtonElement>("sourceTab");
const previewPane = el<HTMLElement>("previewPane");
const sourcePane = el<HTMLElement>("sourcePane");
const pointCount = el<HTMLElement>("pointCount");
const sourceLoad = el<HTMLElement>("sourceLoad");
const sourceLoadText = el<HTMLElement>("sourceLoadText");
const sourceLoadPercent = el<HTMLElement>("sourceLoadPercent");
const sourceProgress = el<HTMLProgressElement>("sourceProgress");
const editorShell = el<HTMLElement>("editorShell");
const lineNumbers = el<HTMLElement>("lineNumbers");
const sourceInput = el<HTMLTextAreaElement>("sourceInput");
const sourceTokens = el<HTMLElement>("sourceTokens");
const sourceStatus = el<HTMLElement>("sourceStatus");
const applySource = el<HTMLButtonElement>("applySource");
const saveSource = el<HTMLButtonElement>("saveSource");
const resetSource = el<HTMLButtonElement>("resetSource");
const normaliseSource = el<HTMLButtonElement>("normaliseSource");

let data: FlatTrackPayload | null = null;
let pts: readonly TrackTextPoint[] | null = null;
let base: readonly TrackTextPoint[] | null = null;
let timer: number | null = null;
let ready = false;
let busy = false;
let dirty = false;
let version = 0;
let lines = 0;

previewTab.addEventListener("click", () => selectPane(false));
sourceTab.addEventListener("click", () => selectPane(true));
sourceInput.addEventListener("input", onInput);
sourceInput.addEventListener("scroll", syncScroll);
applySource.addEventListener("click", () => commit(false));
saveSource.addEventListener("click", () => commit(true));
resetSource.addEventListener("click", reset);
normaliseSource.addEventListener("click", normalise);

window.addEventListener("message", (event: MessageEvent<TrackPreviewHostMessage>) => {
  if (event.data.type !== "track") return;
  version++;
  data = event.data.payload;
  const incoming = pointsFromFlat(data.points);
  if (event.data.resetOriginal || base === null) base = clone(incoming);
  pts = incoming;
  ready = false;
  busy = false;
  sourceInput.value = "";
  sourceTokens.replaceChildren();
  lineNumbers.replaceChildren();
  lines = incoming.length;
  pointCount.textContent = incoming.length.toLocaleString("en-GB");
  setBusy(false);
  setDirty(!same(incoming, base));
  setButtons(false);
  setStatus("Select Track source to prepare the editable coordinates.", false);
  renderMeta(data);
  draw(data);
  if (!sourcePane.hidden) void prepare(incoming);
});

new ResizeObserver(() => {
  if (data !== null) draw(data);
}).observe(canvas);

const readyMsg: TrackPreviewWebviewMessage = { type: "ready" };
vscode.postMessage(readyMsg);

function selectPane(source: boolean): void {
  previewTab.setAttribute("aria-selected", source ? "false" : "true");
  sourceTab.setAttribute("aria-selected", source ? "true" : "false");
  previewPane.hidden = source;
  sourcePane.hidden = !source;
  if (source && pts !== null) {
    void prepare(pts);
  } else if (!source && data !== null) {
    const current = data;
    window.setTimeout(() => draw(current), 0);
  }
}

async function prepare(points: readonly TrackTextPoint[]): Promise<void> {
  if (ready || busy) return;
  const rev = version;
  const batch = Math.max(250, Math.min(2_000, Math.ceil(points.length / 100)));
  const bodies: string[] = [];
  const nums: string[] = [];
  const width = Math.max(6, String(Math.max(0, points.length - 1)).length);
  let body = "";
  let gutter = "";

  busy = true;
  setBusy(true);
  setButtons(false);
  setProgress(1, "Preparing track source…");
  await nextPaint();

  try {
    for (let index = 0; index < points.length; index++) {
      const point = points[index];
      if (point === undefined) throw new Error(`Point ${index} is missing.`);
      body += `${point.x}, ${point.y}\n`;
      gutter += `${String(index).padStart(width, "0")}\n`;
      if ((index + 1) % batch === 0 || index + 1 === points.length) {
        bodies.push(body);
        nums.push(gutter);
        body = "";
        gutter = "";
        setProgress(5 + Math.round((index + 1) / Math.max(1, points.length) * 60), `Preparing ${index + 1} of ${points.length} points…`);
        await nextPaint();
        if (rev !== version) return;
      }
    }

    sourceInput.value = bodies.join("");
    lineNumbers.textContent = nums.join("");
    lines = points.length;
    setProgress(68, "Colour-coding track source…");
    await nextPaint();
    if (rev !== version) return;

    const global = globalThis as unknown as TrackMarkupGlobal;
    const renderer = global.__SANDSARA_TRACK_MARKUP__;
    const html: string[] = [];
    for (let index = 0; index < bodies.length; index++) {
      const part = bodies[index];
      if (part === undefined) continue;
      html.push(renderer === undefined ? renderTrackBodyTokens(part) : renderer(part));
      setProgress(68 + Math.round((index + 1) / Math.max(1, bodies.length) * 28), `Colour-coding ${index + 1} of ${bodies.length} blocks…`);
      await nextPaint();
      if (rev !== version) return;
    }

    sourceTokens.innerHTML = html.join("");
    pts = clone(points);
    ready = true;
    syncScroll();
    setDirty(base !== null && !same(pts, base));
    pointCount.textContent = pts.length.toLocaleString("en-GB");
    setStatus(`${pts.length.toLocaleString("en-GB")} valid points in memory.`, false);
    setProgress(100, "Track source ready.");
    await wait(220);
  } catch (error: unknown) {
    if (rev === version) {
      pts = null;
      ready = false;
      setStatus(err(error), true);
    }
  } finally {
    if (rev === version) {
      busy = false;
      setBusy(false);
      setButtons(pts !== null);
    }
  }
}

function onInput(): void {
  renderTokens(false);
  const count = lineCount(sourceInput.value);
  if (count !== lines) {
    lines = count;
    renderNumbers(count);
  }
  pointCount.textContent = count.toLocaleString("en-GB");
  setDirty(true);
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(validate, 150);
}

function validate(): void {
  timer = null;
  if (!ready) {
    pts = null;
    setStatus("Prepare the track source before editing.", true);
    setButtons(false);
    return;
  }
  try {
    const parsed = parseTrackBody(sourceInput.value);
    pts = parsed.points;
    pointCount.textContent = pts.length.toLocaleString("en-GB");
    setDirty(base !== null && !same(pts, base));
    setStatus(`${pts.length.toLocaleString("en-GB")} valid points in memory.`, false);
    setButtons(true);
  } catch (error: unknown) {
    pts = null;
    setDirty(true);
    setStatus(err(error), true);
    setButtons(false);
  }
}

function commit(save: boolean): void {
  validate();
  if (pts === null || data === null) return;
  const source = formatTrackBody(pts);
  const msg: TrackPreviewWebviewMessage = save
    ? {
        type: "saveTrack",
        points: flat(pts),
        source,
        suggestedName: safeName(data.filename)
      }
    : { type: "editTrack", points: flat(pts), source };
  vscode.postMessage(msg);
  setStatus(save ? "Saving the edited track…" : "Applying the edited track…", false);
}

function reset(): void {
  if (base === null || !dirty) return;
  if (!window.confirm("Reset every edit to the originally loaded track?")) return;
  const msg: TrackPreviewWebviewMessage = { type: "resetTrack" };
  vscode.postMessage(msg);
  setStatus("Resetting to the original track…", false);
}

function normalise(): void {
  validate();
  if (pts === null) return;
  sourceInput.value = formatTrackBody(pts);
  lines = pts.length;
  renderNumbers(lines);
  renderTokens(false);
  syncScroll();
  setStatus("Coordinate spacing normalised without changing the track.", false);
}

function renderTokens(useMarked: boolean): void {
  const source = sourceInput.value;
  const global = globalThis as unknown as TrackMarkupGlobal;
  const renderer = useMarked ? global.__SANDSARA_TRACK_MARKUP__ : undefined;
  sourceTokens.innerHTML = renderer === undefined ? renderTrackBodyTokens(source) : renderer(source);
  syncScroll();
}

function renderNumbers(count: number): void {
  const width = Math.max(6, String(Math.max(0, count - 1)).length);
  const out: string[] = [];
  for (let index = 0; index < count; index++) out.push(String(index).padStart(width, "0"));
  lineNumbers.textContent = out.length === 0 ? "" : `${out.join("\n")}\n`;
  syncScroll();
}

function syncScroll(): void {
  sourceTokens.scrollTop = sourceInput.scrollTop;
  sourceTokens.scrollLeft = sourceInput.scrollLeft;
  lineNumbers.scrollTop = sourceInput.scrollTop;
}

function setBusy(value: boolean): void {
  document.body.classList.toggle("source-busy", value);
  sourceTab.setAttribute("aria-busy", value ? "true" : "false");
  sourceTab.textContent = value ? "Loading source…" : "Track source";
  sourceLoad.hidden = !value;
  editorShell.hidden = value || !ready;
  sourceInput.disabled = value || !ready;
  if (!value) sourceProgress.value = 0;
}

function setProgress(value: number, text: string): void {
  const progress = Math.max(0, Math.min(100, Math.round(value)));
  sourceProgress.value = progress;
  sourceLoadText.textContent = text;
  sourceLoadPercent.textContent = `${progress}%`;
}

function setButtons(valid: boolean): void {
  const usable = valid && !busy;
  applySource.disabled = !usable || !dirty;
  saveSource.disabled = !usable;
  resetSource.disabled = !usable || !dirty || base === null;
  normaliseSource.disabled = !usable;
}

function setDirty(value: boolean): void {
  dirty = value;
  document.body.dataset.trackDirty = value ? "true" : "false";
  const detail: DirtyDetail = { dirty: value };
  window.dispatchEvent(new CustomEvent<DirtyDetail>("sandsara-track-dirty", { detail }));
  if (ready) setButtons(pts !== null);
}

function setStatus(text: string, bad: boolean): void {
  sourceStatus.textContent = text;
  sourceStatus.classList.toggle("error", bad);
}

function renderMeta(payload: FlatTrackPayload): void {
  filename.textContent = payload.filename ?? "Sandsara track";
  const rows: ReadonlyArray<readonly [string, string]> = [
    ["File size", optional(payload.byteLength, " bytes")],
    ["Points", payload.pointCount.toLocaleString("en-GB")],
    ["X range", range(payload.minX, payload.maxX)],
    ["Y range", range(payload.minY, payload.maxY)],
    ["Maximum radius", payload.maximumRadius === undefined ? "Unknown" : payload.maximumRadius.toFixed(2)]
  ];
  stats.replaceChildren(...rows.flatMap(([label, value]) => {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    return [term, description];
  }));
  const notes = payload.warnings ?? [];
  warnings.hidden = notes.length === 0;
  warnings.replaceChildren(...notes.map(note => {
    const paragraph = document.createElement("p");
    paragraph.textContent = note;
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
  const colour = styles.getPropertyValue("--sandsara-track-line").trim() ||
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
  context.strokeStyle = colour;
  context.lineWidth = Math.max(1.4, ratio * 1.1);
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(centre + firstX * scale, centre - firstY * scale);
  for (let index = stride; index < count; index += stride) {
    const x = payload.points[index * 2];
    const y = payload.points[index * 2 + 1];
    if (x !== undefined && y !== undefined) context.lineTo(centre + x * scale, centre - y * scale);
  }
  const finalX = payload.points.at(-2);
  const finalY = payload.points.at(-1);
  if (finalX !== undefined && finalY !== undefined) context.lineTo(centre + finalX * scale, centre - finalY * scale);
  context.stroke();
  marker(context, centre, scale, firstX, firstY, "--vscode-charts-green", ratio);
  if (finalX !== undefined && finalY !== undefined) marker(context, centre, scale, finalX, finalY, "--vscode-charts-red", ratio);
}

function marker(
  context: CanvasRenderingContext2D,
  centre: number,
  scale: number,
  x: number,
  y: number,
  variable: string,
  ratio: number
): void {
  const styles = getComputedStyle(document.body);
  context.fillStyle = styles.getPropertyValue(variable);
  context.beginPath();
  context.arc(centre + x * scale, centre - y * scale, 4 * ratio, 0, Math.PI * 2);
  context.fill();
}

function pointsFromFlat(values: readonly number[]): TrackTextPoint[] {
  const out: TrackTextPoint[] = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    const x = values[index];
    const y = values[index + 1];
    if (x !== undefined && y !== undefined) out.push({ x, y });
  }
  return out;
}

function flat(points: readonly TrackTextPoint[]): number[] {
  return points.flatMap(point => [point.x, point.y]);
}

function clone(points: readonly TrackTextPoint[]): TrackTextPoint[] {
  return points.map(point => ({ x: point.x, y: point.y }));
}

function same(left: readonly TrackTextPoint[], right: readonly TrackTextPoint[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    const a = left[index];
    const b = right[index];
    if (a === undefined || b === undefined || a.x !== b.x || a.y !== b.y) return false;
  }
  return true;
}

function lineCount(source: string): number {
  if (source.length === 0) return 0;
  const text = source.replace(/\r\n?/g, "\n");
  const ends = text.endsWith("\n");
  let count = ends ? 0 : 1;
  for (let index = 0; index < text.length; index++) if (text.charCodeAt(index) === 10) count++;
  return ends ? Math.max(0, count - 1) : count;
}

function safeName(value: string | undefined): string {
  const stem = (value ?? "Sandsara-trackNumber-edited.bin").replace(/\.bin$/i, "");
  return `${stem}-edited.bin`;
}

function optional(value: number | undefined, suffix: string): string {
  return value === undefined ? "Unknown" : `${value.toLocaleString("en-GB")}${suffix}`;
}

function range(minimum: number | undefined, maximum: number | undefined): string {
  return minimum === undefined || maximum === undefined ? "Unknown" : `${minimum} to ${maximum}`;
}

function err(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function el<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (value === null) throw new Error(`Missing track editor element: ${id}`);
  return value as T;
}

function nextPaint(): Promise<void> {
  return new Promise(resolve => window.requestAnimationFrame(() => resolve()));
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}
