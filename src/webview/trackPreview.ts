import type {
  FlatTrackPayload,
  TrackPreviewHostMessage,
  TrackPreviewWebviewMessage
} from "./types";

const vscode = acquireVsCodeApi();
const app = document.getElementById("app");

if (app === null) {
  throw new Error("The track preview root element is missing.");
}

app.innerHTML = `
<style>
  :root { color-scheme: light dark; }
  body {
    box-sizing: border-box;
    margin: 0;
    padding: 16px;
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editor-background);
    font-family: var(--vscode-font-family);
  }
  h1 { margin: 0 0 4px; font-size: 1.3rem; }
  .filename { margin-bottom: 16px; color: var(--vscode-descriptionForeground); }
  .layout {
    display: grid;
    grid-template-columns: minmax(300px, 1fr) minmax(220px, 320px);
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
  @media (max-width: 750px) {
    .layout { grid-template-columns: 1fr; }
  }
</style>
<h1>Sandsara track</h1>
<div id="filename" class="filename">Loading…</div>
<div class="layout">
  <canvas id="preview" aria-label="Sandsara path preview"></canvas>
  <section>
    <dl id="statistics"></dl>
    <section id="warnings" class="warnings" hidden></section>
  </section>
</div>`;

const canvas = requiredElement<HTMLCanvasElement>("preview");
const filenameElement = requiredElement<HTMLElement>("filename");
const statisticsElement = requiredElement<HTMLElement>("statistics");
const warningsElement = requiredElement<HTMLElement>("warnings");

let currentPayload: FlatTrackPayload | undefined;

window.addEventListener("message", (event: MessageEvent<TrackPreviewHostMessage>) => {
  if (event.data.type !== "track") {
    return;
  }

  currentPayload = event.data.payload;
  renderMetadata(currentPayload);
  draw(currentPayload);
});

new ResizeObserver(() => {
  if (currentPayload !== undefined) {
    draw(currentPayload);
  }
}).observe(canvas);

const readyMessage: TrackPreviewWebviewMessage = { type: "ready" };
vscode.postMessage(readyMessage);

function renderMetadata(payload: FlatTrackPayload): void {
  filenameElement.textContent = payload.filename ?? "Sandsara track";

  const rows: ReadonlyArray<readonly [string, string]> = [
    ["File size", formatOptionalNumber(payload.byteLength, " bytes")],
    ["Points", payload.pointCount.toLocaleString("en-GB")],
    ["X range", formatRange(payload.minX, payload.maxX)],
    ["Y range", formatRange(payload.minY, payload.maxY)],
    [
      "Maximum radius",
      payload.maximumRadius === undefined
        ? "Unknown"
        : payload.maximumRadius.toFixed(2)
    ],
    [
      "Preview points",
      Math.floor(payload.points.length / 2).toLocaleString("en-GB")
    ]
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
  if (context === null) {
    return;
  }

  const ratio = window.devicePixelRatio || 1;
  const bounds = canvas.getBoundingClientRect();
  const cssSize = Math.max(1, bounds.width);

  canvas.width = Math.max(1, Math.floor(cssSize * ratio));
  canvas.height = Math.max(1, Math.floor(cssSize * ratio));

  const width = canvas.width;
  const height = canvas.height;
  const padding = 18 * ratio;
  const radius = Math.min(width, height) / 2 - padding;
  const centreX = width / 2;
  const centreY = height / 2;
  const scale = radius / 32_768;
  const styles = getComputedStyle(document.body);
  const trackColour = styles.getPropertyValue("--sandsara-track-line").trim() ||
    styles.getPropertyValue("--vscode-editor-foreground").trim() || "#000000";

  context.clearRect(0, 0, width, height);
  context.strokeStyle = styles.getPropertyValue("--vscode-panel-border");
  context.lineWidth = ratio;
  context.beginPath();
  context.arc(centreX, centreY, radius, 0, Math.PI * 2);
  context.stroke();

  if (payload.points.length < 2) {
    return;
  }

  context.strokeStyle = trackColour;
  context.lineWidth = Math.max(1.4, ratio * 1.1);
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();

  for (let index = 0; index < payload.points.length; index += 2) {
    const rawX = payload.points[index];
    const rawY = payload.points[index + 1];
    if (rawX === undefined || rawY === undefined) {
      continue;
    }

    const x = centreX + rawX * scale;
    const y = centreY - rawY * scale;

    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }

  context.stroke();

  const firstX = payload.points[0];
  const firstY = payload.points[1];
  const finalX = payload.points.at(-2);
  const finalY = payload.points.at(-1);

  if (firstX !== undefined && firstY !== undefined) {
    drawMarker(context, centreX, centreY, scale, firstX, firstY, "--vscode-charts-green", ratio);
  }

  if (finalX !== undefined && finalY !== undefined) {
    drawMarker(context, centreX, centreY, scale, finalX, finalY, "--vscode-charts-red", ratio);
  }
}

function drawMarker(
  context: CanvasRenderingContext2D,
  centreX: number,
  centreY: number,
  scale: number,
  rawX: number,
  rawY: number,
  colourVariable: string,
  ratio: number
): void {
  const styles = getComputedStyle(document.body);
  context.fillStyle = styles.getPropertyValue(colourVariable);
  context.beginPath();
  context.arc(
    centreX + rawX * scale,
    centreY - rawY * scale,
    4 * ratio,
    0,
    Math.PI * 2
  );
  context.fill();
}

function formatOptionalNumber(value: number | undefined, suffix: string): string {
  return value === undefined ? "Unknown" : `${value.toLocaleString("en-GB")}${suffix}`;
}

function formatRange(minimum: number | undefined, maximum: number | undefined): string {
  if (minimum === undefined || maximum === undefined) {
    return "Unknown";
  }
  return `${minimum} to ${maximum}`;
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing webview element: ${id}`);
  }
  return element as T;
}
