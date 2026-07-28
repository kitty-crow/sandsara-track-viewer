import type { FlatTrackPayload, TrackPreviewHostMessage } from "./types";

const basePointsPerSecond = 6_000;
let payload: FlatTrackPayload | undefined;
let progress = 0;
let frameId: number | undefined;
let previousTime = 0;
let running = false;
let playButton: HTMLButtonElement | undefined;
let fullButton: HTMLButtonElement | undefined;
let speedInput: HTMLInputElement | undefined;
let speedNumber: HTMLInputElement | undefined;
let statusElement: HTMLElement | undefined;

installControls();
new MutationObserver(installControls).observe(document.documentElement, {
  childList: true,
  subtree: true
});

window.addEventListener("message", (event: MessageEvent<TrackPreviewHostMessage>) => {
  if (event.data.type !== "track") {
    return;
  }
  payload = event.data.payload;
  progress = 0;
  stop();
  installControls();
  setControlsReady(true);
  setStatus("Ready to play the drawing.");
});

function installControls(): void {
  if (document.getElementById("trackPlayback") !== null) {
    return;
  }
  const stats = document.getElementById("statistics");
  const panel = stats?.parentElement;
  if (panel === undefined || panel === null) {
    return;
  }

  const controls = document.createElement("section");
  controls.id = "trackPlayback";
  controls.className = "track-playback";
  controls.setAttribute("aria-label", "Track drawing playback");
  controls.innerHTML = `
    <div class="track-playback-buttons">
      <button id="trackPlay" type="button" disabled>Play drawing</button>
      <button id="trackFull" type="button" disabled>Show full track</button>
    </div>
    <label class="track-playback-speed" for="trackSpeed">Drawing speed</label>
    <div class="control-row">
      <input id="trackSpeed" type="range" min="-2" max="0" step="0.01" value="-1" aria-label="Drawing speed slider">
      <input id="trackSpeedValue" class="value range-number" type="number" min="0.01" max="1" step="0.01" value="0.1" aria-label="Drawing speed value">
    </div>
    <p id="trackPlaybackStatus" class="track-playback-status">Load a track to animate its drawing.</p>
  `;
  panel.prepend(controls);
  installStyle();

  playButton = requiredElement<HTMLButtonElement>("trackPlay");
  fullButton = requiredElement<HTMLButtonElement>("trackFull");
  speedInput = requiredElement<HTMLInputElement>("trackSpeed");
  speedNumber = requiredElement<HTMLInputElement>("trackSpeedValue");
  statusElement = requiredElement<HTMLElement>("trackPlaybackStatus");

  playButton.addEventListener("click", toggle);
  fullButton.addEventListener("click", showFullTrack);
  speedInput.addEventListener("input", syncSpeedNumber);
  speedNumber.addEventListener("input", syncSpeedSlider);
  speedNumber.addEventListener("change", syncSpeedSlider);
  syncSpeedNumber();
  setControlsReady(payload !== undefined);

  const canvas = document.getElementById("preview");
  if (canvas instanceof HTMLCanvasElement) {
    new ResizeObserver(() => {
      if (payload !== undefined && progress > 0) {
        window.setTimeout(render, 0);
      }
    }).observe(canvas);
  }

  new MutationObserver(() => {
    if (payload !== undefined) {
      window.setTimeout(() => {
        if (progress > 0) {
          render();
        }
      }, 0);
    }
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"]
  });
}

function toggle(): void {
  if (payload === undefined) {
    return;
  }
  if (running) {
    stop();
    setStatus(`Paused at ${formatProgress()}.`);
    return;
  }

  const total = pointCount(payload);
  if (progress >= total) {
    progress = 1;
  } else if (progress <= 0) {
    progress = 1;
  }
  running = true;
  previousTime = performance.now();
  updatePlayButton();
  setStatus(`Drawing ${formatProgress()}…`);
  frameId = window.requestAnimationFrame(tick);
}

function tick(now: number): void {
  const current = payload;
  if (!running || current === undefined) {
    return;
  }

  const elapsedSeconds = Math.max(0, now - previousTime) / 1_000;
  previousTime = now;
  progress += elapsedSeconds * basePointsPerSecond * speed();
  const total = pointCount(current);

  if (progress >= total) {
    progress = total;
    render();
    stop();
    setStatus("Drawing complete.");
    return;
  }

  render();
  setStatus(`Drawing ${formatProgress()}…`);
  frameId = window.requestAnimationFrame(tick);
}

function showFullTrack(): void {
  if (payload === undefined) {
    return;
  }
  stop();
  progress = pointCount(payload);
  render();
  setStatus("Showing the complete track.");
}

function stop(): void {
  running = false;
  if (frameId !== undefined) {
    window.cancelAnimationFrame(frameId);
    frameId = undefined;
  }
  updatePlayButton();
}

function render(): void {
  const current = payload;
  const canvas = document.getElementById("preview");
  if (current === undefined || !(canvas instanceof HTMLCanvasElement)) {
    return;
  }
  const context = canvas.getContext("2d");
  if (context === null) {
    return;
  }

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

  const total = pointCount(current);
  const completed = Math.max(1, Math.min(total, Math.floor(progress)));
  const firstX = current.points[0];
  const firstY = current.points[1];
  if (firstX === undefined || firstY === undefined) {
    return;
  }

  context.strokeStyle = trackColour;
  context.lineWidth = Math.max(1.4, ratio * 1.1);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(centre + firstX * scale, centre - firstY * scale);

  for (let pointIndex = 1; pointIndex < completed; pointIndex++) {
    const rawX = current.points[pointIndex * 2];
    const rawY = current.points[pointIndex * 2 + 1];
    if (rawX !== undefined && rawY !== undefined) {
      context.lineTo(centre + rawX * scale, centre - rawY * scale);
    }
  }
  context.stroke();

  drawMarker(context, firstX, firstY, centre, scale, ratio, "--vscode-charts-green", 3.5);
  const ballX = current.points[(completed - 1) * 2];
  const ballY = current.points[(completed - 1) * 2 + 1];
  if (ballX !== undefined && ballY !== undefined) {
    drawMarker(context, ballX, ballY, centre, scale, ratio, "--vscode-charts-green", 5.2);
  }

  if (completed >= total) {
    const finalX = current.points.at(-2);
    const finalY = current.points.at(-1);
    if (finalX !== undefined && finalY !== undefined) {
      drawMarker(context, finalX, finalY, centre, scale, ratio, "--vscode-charts-red", 4.2);
    }
  }
}

function drawMarker(
  context: CanvasRenderingContext2D,
  rawX: number,
  rawY: number,
  centre: number,
  scale: number,
  ratio: number,
  colourVariable: string,
  radius: number
): void {
  const styles = getComputedStyle(document.body);
  context.fillStyle = styles.getPropertyValue(colourVariable).trim() || "#557d68";
  context.beginPath();
  context.arc(
    centre + rawX * scale,
    centre - rawY * scale,
    radius * ratio,
    0,
    Math.PI * 2
  );
  context.fill();
}

function setControlsReady(ready: boolean): void {
  if (playButton !== undefined) {
    playButton.disabled = !ready;
  }
  if (fullButton !== undefined) {
    fullButton.disabled = !ready;
  }
}

function updatePlayButton(): void {
  if (playButton !== undefined) {
    playButton.textContent = running ? "Pause drawing" : "Play drawing";
  }
}

function syncSpeedNumber(): void {
  if (speedNumber !== undefined) {
    speedNumber.value = formatSpeed(speed());
  }
}

function syncSpeedSlider(): void {
  if (speedInput === undefined || speedNumber === undefined) {
    return;
  }
  const parsed = Number(speedNumber.value);
  if (!Number.isFinite(parsed) || speedNumber.value.trim() === "") {
    return;
  }
  const value = Math.min(1, Math.max(0.01, parsed));
  speedInput.value = String(Math.log10(value));
  speedNumber.value = formatSpeed(value);
}

function speed(): number {
  const exponent = Number(speedInput?.value ?? "-1");
  const value = 10 ** (Number.isFinite(exponent) ? exponent : -1);
  return Math.min(1, Math.max(0.01, value));
}

function formatSpeed(value: number): string {
  return value < 0.1 ? value.toFixed(2) : value.toFixed(1);
}

function pointCount(current: FlatTrackPayload): number {
  return Math.floor(current.points.length / 2);
}

function formatProgress(): string {
  const current = payload;
  if (current === undefined) {
    return "0%";
  }
  const total = Math.max(1, pointCount(current));
  return `${Math.min(100, Math.round(progress / total * 100))}%`;
}

function setStatus(text: string): void {
  if (statusElement !== undefined) {
    statusElement.textContent = text;
  }
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing playback element: ${id}`);
  }
  return element as T;
}

function installStyle(): void {
  if (document.getElementById("trackPlaybackStyle") !== null) {
    return;
  }
  const style = document.createElement("style");
  style.id = "trackPlaybackStyle";
  style.textContent = `
    .track-playback {
      display: grid;
      gap: 0.7rem;
      margin-bottom: 1.15rem;
      padding: 0.9rem;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
    }
    .track-playback-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 0.55rem;
    }
    .track-playback button {
      padding: 0.55rem 0.8rem;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border: 0;
      cursor: pointer;
    }
    .track-playback button:disabled {
      opacity: 0.55;
      cursor: default;
    }
    .track-playback-speed {
      font-weight: 650;
    }
    .track-playback .control-row {
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }
    .track-playback input[type="range"] {
      width: 100%;
    }
    .track-playback-status {
      margin: 0;
      color: var(--vscode-descriptionForeground);
      font-size: 0.9rem;
    }
  `;
  document.head.append(style);
}
