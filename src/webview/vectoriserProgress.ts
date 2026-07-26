const app = document.getElementById("app");

if (app !== null && !document.body.classList.contains("site-body")) {
  installProgressOverlay(app);
}

function installProgressOverlay(root: HTMLElement): void {
  const panel = document.createElement("section");
  panel.className = "vectoriser-progress";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="vectoriser-progress-heading">
      <strong data-progress-stage>Preparing image processing…</strong>
      <span data-progress-percent>0%</span>
    </div>
    <progress data-progress-bar max="100" value="0">0%</progress>
    <div class="vectoriser-progress-timing" data-progress-timing>Estimating remaining time…</div>
  `;

  const style = document.createElement("style");
  style.textContent = `
    .vectoriser-progress {
      display: grid;
      gap: 8px;
      margin: 0 0 14px;
      padding: 12px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-sideBar-background);
    }
    .vectoriser-progress[hidden] { display: none; }
    .vectoriser-progress-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .vectoriser-progress progress {
      width: 100%;
      height: 9px;
      accent-color: var(--vscode-progressBar-background, var(--vscode-button-background));
    }
    .vectoriser-progress-timing {
      color: var(--vscode-descriptionForeground);
      font-size: 0.86rem;
    }
  `;
  document.head.append(style);
  root.parentElement?.insertBefore(panel, root);

  const stage = requiredElement<HTMLElement>(panel, "[data-progress-stage]");
  const percent = requiredElement<HTMLElement>(panel, "[data-progress-percent]");
  const bar = requiredElement<HTMLProgressElement>(panel, "[data-progress-bar]");
  const timing = requiredElement<HTMLElement>(panel, "[data-progress-timing]");

  let startedAt = 0;
  let timer: number | undefined;
  let active = false;

  const observer = new MutationObserver(() => {
    const statistics = root.querySelector<HTMLElement>("#stats");
    const text = statistics?.textContent ?? "";

    if (/Processing/i.test(text) && !active) {
      active = true;
      startedAt = performance.now();
      panel.hidden = false;
      update(4);
      timer = window.setInterval(() => {
        const elapsed = performance.now() - startedAt;
        const estimated = 9_000;
        const progress = Math.min(96, 4 + elapsed / estimated * 92);
        update(progress);
      }, 160);
      return;
    }

    if (active && /vector points|vector lines/i.test(text) && !/Processing/i.test(text)) {
      active = false;
      if (timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
      update(100);
      timing.textContent = `Completed in ${formatDuration(performance.now() - startedAt)}`;
    }
  });

  observer.observe(root, { subtree: true, childList: true, characterData: true });

  function update(value: number): void {
    const safe = Math.max(0, Math.min(100, value));
    bar.value = safe;
    percent.textContent = `${Math.round(safe)}%`;
    stage.textContent = labelFor(safe);

    if (safe >= 100) {
      return;
    }

    const elapsed = performance.now() - startedAt;
    const remaining = safe <= 4 ? undefined : elapsed / safe * (100 - safe);
    timing.textContent = remaining === undefined
      ? "Estimating remaining time…"
      : `Elapsed ${formatDuration(elapsed)} · about ${formatDuration(remaining)} remaining`;
  }
}

function labelFor(progress: number): string {
  if (progress < 12) return "Decoding the image…";
  if (progress < 24) return "Resizing to the processing resolution…";
  if (progress < 38) return "Converting to greyscale and adjusting contrast…";
  if (progress < 50) return "Reducing image noise…";
  if (progress < 66) return "Detecting edges and contours…";
  if (progress < 82) return "Tracing continuous vector lines…";
  if (progress < 94) return "Simplifying and filtering paths…";
  if (progress < 100) return "Rendering the vector preview…";
  return "Vectorisation complete.";
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector(selector);
  if (element === null) {
    throw new Error(`Missing vectoriser progress element: ${selector}`);
  }
  return element as T;
}
