import type {
  FlatTrackPayload,
  TrackEditorState,
  TrackPreviewHostMessage,
  TrackPreviewWebviewMessage
} from "./types";
import {
  formatTrackBody,
  formatTrackIssues,
  inspectTrackBody,
  renderTrackBodyTokens,
  type TrackBodyIssue,
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
  button {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    border: 0;
    cursor: pointer;
    font: inherit;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: 0.5; cursor: default; }
  .track-editor-card {
    --track-state: var(--vscode-panel-border, rgba(127, 127, 127, 0.55));
    overflow: visible;
    padding: 1rem;
    border: 2px solid var(--track-state);
    border-radius: 1rem;
    background: var(--vscode-editor-background);
    transition: border-color 160ms ease, box-shadow 160ms ease;
  }
  .track-editor-card[data-state="saved"] { --track-state: var(--vscode-testing-iconPassed, #2da44e); }
  .track-editor-card[data-state="dirty"] { --track-state: var(--vscode-editorWarning-foreground, #d4a72c); }
  .track-editor-card[data-state="invalid"] { --track-state: var(--vscode-errorForeground, #f85149); }
  .track-editor-card[data-state="saving"] {
    --track-state: var(--vscode-progressBar-background, #58a6ff);
    animation: track-state-pulse 1.15s ease-in-out infinite;
  }
  .track-editor-card[data-state="loading"] {
    --track-state: var(--vscode-charts-purple, #a371f7);
    animation: track-state-pulse 1.15s ease-in-out infinite;
  }
  @keyframes track-state-pulse {
    0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--track-state) 10%, transparent); }
    50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--track-state) 34%, transparent); }
  }
  @media (prefers-reduced-motion: reduce) { .track-editor-card { animation: none !important; } }
  .editor-head {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }
  .editor-title {
    display: grid;
    gap: 0.2rem;
    min-width: 0;
    margin-right: auto;
  }
  h1 { margin: 0; font-size: 1.3rem; }
  .filename,
  .editor-status,
  .source-status { color: var(--vscode-descriptionForeground); }
  .filename { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .editor-status { margin: 0 0 0.85rem; }
  .editor-status.error,
  .source-status.error { color: var(--vscode-errorForeground, var(--vscode-editorError-foreground)); }
  .open-track,
  .empty-open {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.55rem;
    flex: 0 0 auto;
    padding: 0.68rem 0.9rem;
    border-radius: 999px;
    font-weight: 700;
  }
  .open-track svg,
  .empty-open svg,
  .icon-button svg {
    width: 1.15rem;
    height: 1.15rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.9;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .empty-state {
    display: grid;
    justify-items: center;
    gap: 0.8rem;
    min-height: 18rem;
    padding: 3rem 1.25rem;
    border: 1px dashed var(--vscode-panel-border);
    border-radius: 0.8rem;
    text-align: center;
  }
  .empty-state[hidden],
  .loaded-editor[hidden],
  .view-pane[hidden],
  .editor-shell[hidden],
  .source-load[hidden],
  .open-track[hidden],
  .preview-notice[hidden] { display: none; }
  .empty-state strong { font-size: 1.1rem; }
  .empty-state p { max-width: 34rem; margin: 0; color: var(--vscode-descriptionForeground); }
  .view-tabs { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 14px; }
  .view-tabs button { padding: 7px 11px; border-radius: 999px; }
  .view-tabs button[aria-selected="true"] { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .layout { display: grid; grid-template-columns: minmax(300px, 1fr) minmax(220px, 340px); gap: 18px; }
  .preview-wrap { display: grid; gap: 0.7rem; }
  .preview-notice {
    margin: 0;
    padding: 0.7rem 0.85rem;
    color: var(--vscode-errorForeground, #f85149);
    border: 1px solid var(--vscode-errorForeground, #f85149);
    border-radius: 0.55rem;
    background: color-mix(in srgb, var(--vscode-errorForeground, #f85149) 8%, transparent);
  }
  canvas {
    display: block;
    width: 100%;
    aspect-ratio: 1;
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-editor-background);
  }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 8px 12px; margin: 0; }
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
  .source-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
  .icon-button {
    position: relative;
    display: inline-grid;
    place-items: center;
    width: 2.55rem;
    height: 2.55rem;
    padding: 0;
    border-radius: 999px;
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
  .icon-button:focus-visible::after { opacity: 1; transform: translate(-50%, 0); }
  .source-load {
    display: grid;
    gap: 7px;
    margin: 4px 0 12px;
    padding: 10px 12px;
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  }
  .source-load-head { display: flex; justify-content: space-between; gap: 12px; color: var(--vscode-descriptionForeground); font-size: 0.9rem; }
  .source-load progress { width: 100%; height: 0.7rem; accent-color: var(--track-state); }
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
  .line-number-invalid { color: var(--vscode-errorForeground, #f85149); font-weight: 750; }
  .editor-code { position: relative; min-width: 0; min-height: 0; overflow: hidden; }
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
  .editor-highlight { z-index: 1; overflow: auto; pointer-events: none; color: var(--vscode-editor-foreground); }
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
  .editor-input::selection { background: var(--vscode-editor-selectionBackground, rgba(120, 160, 220, 0.45)); -webkit-text-fill-color: transparent; }
  .source-status { margin: 9px 0 0; }
  .tok-number,
  .tok-x { color: var(--vscode-symbolIcon-numberForeground, #b5cea8); }
  .tok-y { color: var(--vscode-symbolIcon-stringForeground, #ce9178); }
  .tok-punctuation { color: var(--vscode-editor-foreground); }
  .tok-invalid {
    color: var(--vscode-errorForeground, #f44747);
    text-decoration: underline wavy;
    text-decoration-color: var(--vscode-editorError-foreground, #f44747);
  }
  @media (max-width: 750px) {
    body { padding: 8px; }
    .editor-head { align-items: flex-start; flex-direction: column; }
    .open-track { width: 100%; }
    .layout { grid-template-columns: 1fr; }
    .editor-shell { min-height: 22rem; height: 58vh; }
    .line-gutter { min-width: 4.8rem; }
  }
</style>
<section id="editorCard" class="track-editor-card" data-state="empty" aria-labelledby="editorTitle">
  <header class="editor-head">
    <div class="editor-title">
      <h1 id="editorTitle">Sandsara track editor</h1>
      <div id="filename" class="filename">No track loaded</div>
    </div>
    <button id="openTrack" class="open-track" type="button" title="Open another Sandsara .bin track" hidden>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h6l2 2h10v10H3z"/><path d="M3 7V5h7l2 2"/></svg>
      <span>Open another .bin</span>
    </button>
  </header>
  <p id="editorStatus" class="editor-status" aria-live="polite">Open a Sandsara .bin track to begin.</p>
  <section id="emptyState" class="empty-state">
    <strong>Open a .bin track</strong>
    <p>Decode, preview, edit and save the track entirely in memory.</p>
    <button id="openEmpty" class="empty-open" type="button" title="Open a Sandsara .bin track">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h6l2 2h10v10H3z"/><path d="M3 7V5h7l2 2"/></svg>
      <span>Choose .bin track</span>
    </button>
  </section>
  <div id="loadedEditor" class="loaded-editor" hidden>
    <div class="view-tabs" role="tablist" aria-label="Track editor view">
      <button id="previewTab" type="button" role="tab" aria-selected="true" aria-controls="previewPane">Preview</button>
      <button id="sourceTab" type="button" role="tab" aria-selected="false" aria-controls="sourcePane">Edit track</button>
    </div>
    <section id="previewPane" class="view-pane" role="tabpanel" aria-labelledby="previewTab">
      <div class="layout">
        <div class="preview-wrap">
          <p id="previewNotice" class="preview-notice" role="alert" hidden></p>
          <canvas id="preview" aria-label="Sandsara path preview"></canvas>
        </div>
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
      <div class="source-actions" role="toolbar" aria-label="Track editing actions">
        <button id="applySource" class="icon-button" type="button" aria-label="Apply edits to preview" data-tip="Apply edits to the preview" title="Apply edits to the preview" disabled>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>
        </button>
        <button id="saveSource" class="icon-button" type="button" aria-label="Save edited .bin" data-tip="Encode and save the edited .bin" title="Encode and save the edited .bin" disabled>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/></svg>
        </button>
        <button id="resetSource" class="icon-button" type="button" aria-label="Reset to original file" data-tip="Reset every edit to the originally loaded file" title="Reset every edit to the originally loaded file" disabled>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v6h6"/></svg>
        </button>
        <button id="normaliseSource" class="icon-button" type="button" aria-label="Normalise coordinate spacing" data-tip="Normalise spacing without changing coordinates" title="Normalise spacing without changing coordinates" disabled>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M7 12h10M9 17h6"/></svg>
        </button>
      </div>
      <div id="sourceLoad" class="source-load" role="status" aria-live="polite" hidden>
        <div class="source-load-head"><span id="sourceLoadText">Preparing editable track…</span><span id="sourceLoadPercent">0%</span></div>
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
    </section>
  </div>
</section>`;

const card = el<HTMLElement>("editorCard");
const filename = el<HTMLElement>("filename");
const editorStatus = el<HTMLElement>("editorStatus");
const emptyState = el<HTMLElement>("emptyState");
const loadedEditor = el<HTMLElement>("loadedEditor");
const openTrack = el<HTMLButtonElement>("openTrack");
const openEmpty = el<HTMLButtonElement>("openEmpty");
const canvas = el<HTMLCanvasElement>("preview");
const previewNotice = el<HTMLElement>("previewNotice");
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
let state: TrackEditorState = "empty";
let badLines = new Set<number>();
let appliedBody = "";

openTrack.addEventListener("click", requestOpen);
openEmpty.addEventListener("click", requestOpen);
previewTab.addEventListener("click", () => selectPane(false));
sourceTab.addEventListener("click", () => selectPane(true));
sourceInput.addEventListener("input", onInput);
sourceInput.addEventListener("scroll", syncScroll);
applySource.addEventListener("click", () => applyMemory(false));
saveSource.addEventListener("click", save);
resetSource.addEventListener("click", reset);
normaliseSource.addEventListener("click", normalise);

window.addEventListener("message", (event: MessageEvent<TrackPreviewHostMessage>) => {
  const msg = event.data;
  if (msg.type === "state") {
    setState(msg.state, msg.message);
    return;
  }
  if (msg.type === "accepted") {
    if (pts !== null) base = clone(pts);
    if (data !== null) data = { ...data, filename: msg.filename };
    filename.textContent = msg.filename;
    appliedBody = sourceInput.value;
    setDirty(false);
    setState("saved", msg.message);
    setSourceStatus(`${pts?.length.toLocaleString("en-GB") ?? "0"} valid points saved and still loaded.`, false);
    return;
  }
  if (msg.type === "preview") {
    updatePreview(msg.payload);
    return;
  }
  if (!msg.resetOriginal && data !== null) {
    updatePreview(msg.payload);
    return;
  }

  version++;
  data = msg.payload;
  const incoming = pointsFromFlat(data.points);
  base = clone(incoming);
  pts = incoming;
  ready = false;
  busy = false;
  badLines.clear();
  sourceInput.value = "";
  sourceTokens.replaceChildren();
  lineNumbers.replaceChildren();
  lines = incoming.length;
  appliedBody = formatTrackBody(incoming);
  pointCount.textContent = incoming.length.toLocaleString("en-GB");
  emptyState.hidden = true;
  loadedEditor.hidden = false;
  openTrack.hidden = false;
  previewNotice.hidden = true;
  renderMeta(data);
  draw(data);
  setBusy(false);
  setDirty(false);
  setButtons(false);
  setSourceStatus("Select Edit track to prepare the editable coordinates.", false);
  setState("saved", `Loaded ${incoming.length.toLocaleString("en-GB")} points. The editor matches the saved track.`);
  if (!sourcePane.hidden) void prepare(incoming);
});

new ResizeObserver(() => {
  if (!previewNotice.hidden) drawInvalid();
  else if (data !== null) draw(data);
}).observe(canvas);

const readyMsg: TrackPreviewWebviewMessage = { type: "ready" };
vscode.postMessage(readyMsg);

function requestOpen(): void {
  const msg: TrackPreviewWebviewMessage = { type: "openTrack" };
  vscode.postMessage(msg);
}

function selectPane(edit: boolean): void {
  if (!edit && ready && !applyMemory(true)) showInvalidPreview();
  previewTab.setAttribute("aria-selected", edit ? "false" : "true");
  sourceTab.setAttribute("aria-selected", edit ? "true" : "false");
  previewPane.hidden = edit;
  sourcePane.hidden = !edit;
  if (edit && pts !== null) void prepare(pts);
  else if (!edit && previewNotice.hidden && data !== null) window.setTimeout(() => draw(data as FlatTrackPayload), 0);
}

async function prepare(points: readonly TrackTextPoint[]): Promise<void> {
  if (ready || busy) return;
  const rev = version;
  const batch = Math.max(250, Math.min(2_000, Math.ceil(points.length / 100)));
  const bodies: string[] = [];
  let body = "";

  busy = true;
  setBusy(true);
  setButtons(false);
  setProgress(1, "Preparing editable track…");
  await nextPaint();

  try {
    for (let index = 0; index < points.length; index++) {
      const point = points[index];
      if (point === undefined) throw new Error(`Point ${index} is missing.`);
      body += `${point.x}, ${point.y}\n`;
      if ((index + 1) % batch === 0 || index + 1 === points.length) {
        bodies.push(body);
        body = "";
        setProgress(5 + Math.round((index + 1) / Math.max(1, points.length) * 60), `Preparing ${index + 1} of ${points.length} points…`);
        await nextPaint();
        if (rev !== version) return;
      }
    }

    sourceInput.value = bodies.join("");
    lines = points.length;
    renderNumbers(lines, badLines);
    setProgress(68, "Colour-coding editable track…");
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
    setSourceStatus(`${pts.length.toLocaleString("en-GB")} valid points in memory.`, false);
    setProgress(100, "Editable track ready.");
    await wait(220);
  } catch (error: unknown) {
    if (rev === version) {
      pts = null;
      ready = false;
      setSourceStatus(err(error), true);
      setState("invalid", err(error));
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
    renderNumbers(count, badLines);
  }
  pointCount.textContent = count.toLocaleString("en-GB");
  setDirty(true);
  setState("dirty", "Unsaved coordinate changes.");
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => validate(), 150);
}

function validate(): boolean {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
  if (!ready) {
    pts = null;
    setSourceStatus("Prepare the editable track before changing it.", true);
    setState("invalid", "The editable track is not ready.");
    setButtons(false);
    return false;
  }

  const inspected = inspectTrackBody(sourceInput.value);
  badLines = new Set(inspected.issues.filter(issue => issue.line > 0).map(issue => issue.line));
  renderNumbers(lineCount(sourceInput.value), badLines);
  renderTokens(false);
  if (inspected.issues.length > 0) {
    pts = null;
    setDirty(true);
    const message = issueMessage(inspected.issues);
    setSourceStatus(message, true);
    setState("invalid", message);
    setButtons(false);
    return false;
  }

  pts = inspected.points;
  pointCount.textContent = pts.length.toLocaleString("en-GB");
  setDirty(base !== null && !same(pts, base));
  setSourceStatus(`${pts.length.toLocaleString("en-GB")} valid points in memory.`, false);
  setState(dirty ? "dirty" : "saved", dirty ? "Unsaved coordinate changes." : "The editor matches the saved track.");
  setButtons(true);
  return true;
}

function applyMemory(fromTab: boolean): boolean {
  if (!validate() || pts === null || data === null) return false;
  const body = sourceInput.value;
  const payload = payloadFromPoints(data.filename ?? "Sandsara track", pts);
  data = payload;
  previewNotice.hidden = true;
  renderMeta(payload);
  draw(payload);
  if (body !== appliedBody) {
    const msg: TrackPreviewWebviewMessage = { type: "editTrack", points: flat(pts), source: formatTrackBody(pts) };
    appliedBody = body;
    vscode.postMessage(msg);
  }
  if (!fromTab) setState(dirty ? "dirty" : "saved", dirty ? "Applied the unsaved edits to the preview." : "The preview matches the saved track.");
  return true;
}

function save(): void {
  if (!validate() || pts === null || data === null) return;
  applyMemory(true);
  const msg: TrackPreviewWebviewMessage = {
    type: "saveTrack",
    points: flat(pts),
    source: formatTrackBody(pts),
    suggestedName: safeName(data.filename)
  };
  setState("saving", "Encoding and saving the edited track…");
  vscode.postMessage(msg);
}

function reset(): void {
  if (base === null || !dirty) return;
  if (!window.confirm("Reset every edit to the originally loaded track?")) return;
  const msg: TrackPreviewWebviewMessage = { type: "resetTrack" };
  setState("loading", "Restoring the originally loaded track…");
  vscode.postMessage(msg);
}

function normalise(): void {
  if (!validate() || pts === null) return;
  sourceInput.value = formatTrackBody(pts);
  lines = pts.length;
  badLines.clear();
  renderNumbers(lines, badLines);
  renderTokens(false);
  syncScroll();
  setDirty(base !== null && !same(pts, base));
  setSourceStatus("Coordinate spacing normalised without changing the track.", false);
  setState(dirty ? "dirty" : "saved", dirty ? "Coordinate spacing normalised. Changes remain unsaved." : "Coordinate spacing normalised. The editor matches the saved track.");
}

function showInvalidPreview(): void {
  const inspected = inspectTrackBody(sourceInput.value);
  const message = issueMessage(inspected.issues);
  previewNotice.textContent = `Track preview unavailable. ${message}`;
  previewNotice.hidden = false;
  drawInvalid();
  window.dispatchEvent(new CustomEvent("sandsara-track-invalid"));
}

function updatePreview(payload: FlatTrackPayload): void {
  data = payload;
  previewNotice.hidden = true;
  renderMeta(payload);
  draw(payload);
}

function renderTokens(useMarked: boolean): void {
  const source = sourceInput.value;
  const global = globalThis as unknown as TrackMarkupGlobal;
  const renderer = useMarked ? global.__SANDSARA_TRACK_MARKUP__ : undefined;
  sourceTokens.innerHTML = renderer === undefined ? renderTrackBodyTokens(source) : renderer(source);
  syncScroll();
}

function renderNumbers(count: number, invalid: ReadonlySet<number>): void {
  const width = Math.max(6, String(Math.max(0, count - 1)).length);
  const out: string[] = [];
  for (let index = 0; index < count; index++) {
    const line = index + 1;
    const cls = invalid.has(line) ? " class=\"line-number-invalid\"" : "";
    out.push(`<span${cls}>${String(index).padStart(width, "0")}</span>`);
  }
  lineNumbers.innerHTML = out.length === 0 ? "" : `${out.join("\n")}\n`;
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
  sourceTab.textContent = value ? "Loading editor…" : "Edit track";
  sourceLoad.hidden = !value;
  editorShell.hidden = value || !ready;
  sourceInput.disabled = value || !ready;
  if (value) setState("loading", "Preparing and colour-coding the editable track…");
  else {
    sourceProgress.value = 0;
    if (data !== null && state === "loading") setState(dirty ? "dirty" : "saved", dirty ? "Editable track ready with unsaved changes." : "Editable track ready. The editor matches the saved track.");
  }
}

function setProgress(value: number, text: string): void {
  const progress = Math.max(0, Math.min(100, Math.round(value)));
  sourceProgress.value = progress;
  sourceLoadText.textContent = text;
  sourceLoadPercent.textContent = `${progress}%`;
}

function setButtons(valid: boolean): void {
  const usable = valid && !busy && state !== "saving";
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

function setState(next: TrackEditorState, message: string): void {
  state = next;
  card.dataset.state = next;
  document.body.dataset.trackState = next;
  editorStatus.textContent = message;
  editorStatus.classList.toggle("error", next === "invalid");
  const locked = next === "loading" || next === "saving";
  openTrack.disabled = locked;
  openEmpty.disabled = locked;
  if (ready) setButtons(pts !== null);
}

function setSourceStatus(text: string, bad: boolean): void {
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

function payloadFromPoints(name: string, points: readonly TrackTextPoint[]): FlatTrackPayload {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maximumRadius = 0;
  let outside = 0;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
    const radius = Math.hypot(point.x, point.y);
    maximumRadius = Math.max(maximumRadius, radius);
    if (radius > 32_768) outside++;
  }
  return {
    points: flat(points),
    pointCount: points.length,
    byteLength: points.length * 6,
    minX,
    maxX,
    minY,
    maxY,
    maximumRadius,
    warnings: outside === 0 ? [] : [`${outside} points lie outside the nominal 32767-unit drawing radius.`],
    filename: name
  };
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
  const colour = styles.getPropertyValue("--sandsara-track-line").trim() || styles.getPropertyValue("--vscode-editor-foreground").trim() || "#000000";
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

function drawInvalid(): void {
  const context = canvas.getContext("2d");
  if (context === null) return;
  const ratio = window.devicePixelRatio || 1;
  const cssSize = Math.max(1, canvas.getBoundingClientRect().width);
  const size = Math.max(1, Math.floor(cssSize * ratio));
  canvas.width = size;
  canvas.height = size;
  const centre = size / 2;
  const outer = size / 2 - 18 * ratio;
  const styles = getComputedStyle(document.body);
  const muted = styles.getPropertyValue("--vscode-descriptionForeground").trim() || "#888";
  const bad = styles.getPropertyValue("--vscode-errorForeground").trim() || "#f85149";
  context.clearRect(0, 0, size, size);
  context.strokeStyle = styles.getPropertyValue("--vscode-panel-border");
  context.lineWidth = Math.max(1, ratio);
  context.beginPath();
  context.arc(centre, centre, outer, 0, Math.PI * 2);
  context.stroke();
  context.save();
  context.globalAlpha = 0.45;
  context.strokeStyle = muted;
  context.lineWidth = Math.max(1.4, ratio * 1.2);
  context.setLineDash([5 * ratio, 5 * ratio]);
  context.beginPath();
  for (let step = 0; step <= 240; step++) {
    const angle = step / 240 * Math.PI * 8;
    const radius = outer * 0.82 * step / 240;
    const x = centre + Math.cos(angle) * radius;
    const y = centre + Math.sin(angle) * radius;
    if (step === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
  context.restore();
  context.fillStyle = bad;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `700 ${Math.max(14, 18 * ratio)}px sans-serif`;
  context.fillText("Invalid track", centre, centre);
}

function marker(context: CanvasRenderingContext2D, centre: number, scale: number, x: number, y: number, variable: string, ratio: number): void {
  const styles = getComputedStyle(document.body);
  context.fillStyle = styles.getPropertyValue(variable);
  context.beginPath();
  context.arc(centre + x * scale, centre - y * scale, 4 * ratio, 0, Math.PI * 2);
  context.fill();
}

function issueMessage(issues: readonly TrackBodyIssue[]): string {
  if (issues.length === 0) return "The track is invalid.";
  const lines = issues.filter(issue => issue.line > 0).map(issue => issue.line);
  const prefix = lines.length === 0 ? "" : `Invalid line${lines.length === 1 ? "" : "s"} ${lines.slice(0, 12).join(", ")}${lines.length > 12 ? ", …" : ""}. `;
  return `${prefix}${formatTrackIssues(issues)}`;
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

function flat(points: readonly TrackTextPoint[]): number[] { return points.flatMap(point => [point.x, point.y]); }
function clone(points: readonly TrackTextPoint[]): TrackTextPoint[] { return points.map(point => ({ x: point.x, y: point.y })); }
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
  return `${stem.replace(/-edited$/i, "")}-edited.bin`;
}
function optional(value: number | undefined, suffix: string): string { return value === undefined ? "Unknown" : `${value.toLocaleString("en-GB")}${suffix}`; }
function range(minimum: number | undefined, maximum: number | undefined): string { return minimum === undefined || maximum === undefined ? "Unknown" : `${minimum} to ${maximum}`; }
function err(value: unknown): string { return value instanceof Error ? value.message : String(value); }
function el<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (value === null) throw new Error(`Missing track editor element: ${id}`);
  return value as T;
}
function nextPaint(): Promise<void> { return new Promise(resolve => window.requestAnimationFrame(() => resolve())); }
function wait(ms: number): Promise<void> { return new Promise(resolve => window.setTimeout(resolve, ms)); }
