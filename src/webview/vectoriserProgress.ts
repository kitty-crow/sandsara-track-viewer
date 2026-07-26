export {};

class Prog {
  private readonly root: HTMLElement;
  private readonly box = document.createElement("section");
  private readonly stage: HTMLElement;
  private readonly pct: HTMLElement;
  private readonly bar: HTMLProgressElement;
  private readonly time: HTMLElement;
  private start = 0;
  private tick: number | undefined;
  private on = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.box.className = "vectoriser-progress";
    this.box.hidden = true;
    this.box.innerHTML = `
      <div class="vectoriser-progress-heading">
        <strong data-stage>Preparing image processing…</strong>
        <span data-pct>0%</span>
      </div>
      <progress data-bar max="100" value="0">0%</progress>
      <div class="vectoriser-progress-timing" data-time>Estimating remaining time…</div>
    `;
    this.stage = this.q<HTMLElement>("[data-stage]");
    this.pct = this.q<HTMLElement>("[data-pct]");
    this.bar = this.q<HTMLProgressElement>("[data-bar]");
    this.time = this.q<HTMLElement>("[data-time]");
  }

  run(): void {
    this.css();
    this.root.parentElement?.insertBefore(this.box, this.root);
    new MutationObserver(() => this.sync()).observe(this.root, {
      subtree: true,
      childList: true,
      characterData: true
    });
  }

  private sync(): void {
    const text = this.root.querySelector<HTMLElement>("#stats")?.textContent ?? "";
    if (/Processing/i.test(text) && !this.on) this.begin();
    if (this.on && /vector points|vector lines/i.test(text) && !/Processing/i.test(text)) this.done();
  }

  private begin(): void {
    this.on = true;
    this.start = performance.now();
    this.box.hidden = false;
    this.set(4);
    this.tick = window.setInterval(() => {
      const elapsed = performance.now() - this.start;
      this.set(Math.min(96, 4 + elapsed / 9_000 * 92));
    }, 160);
  }

  private done(): void {
    this.on = false;
    if (this.tick !== undefined) window.clearInterval(this.tick);
    this.tick = undefined;
    this.set(100);
    this.time.textContent = `Completed in ${this.dur(performance.now() - this.start)}`;
  }

  private set(value: number): void {
    const n = Math.max(0, Math.min(100, value));
    this.bar.value = n;
    this.pct.textContent = `${Math.round(n)}%`;
    this.stage.textContent = this.label(n);
    if (n >= 100) return;
    const elapsed = performance.now() - this.start;
    const left = n <= 4 ? undefined : elapsed / n * (100 - n);
    this.time.textContent = left === undefined
      ? "Estimating remaining time…"
      : `Elapsed ${this.dur(elapsed)} · about ${this.dur(left)} remaining`;
  }

  private label(n: number): string {
    if (n < 12) return "Decoding the image…";
    if (n < 24) return "Resizing to the processing resolution…";
    if (n < 38) return "Converting to greyscale and adjusting contrast…";
    if (n < 50) return "Reducing image noise…";
    if (n < 66) return "Detecting edges and contours…";
    if (n < 82) return "Tracing continuous vector lines…";
    if (n < 94) return "Simplifying and filtering paths…";
    if (n < 100) return "Rendering the vector preview…";
    return "Vectorisation complete.";
  }

  private dur(ms: number): string {
    const sec = Math.max(0, Math.round(ms / 1_000));
    return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
  }

  private q<T extends Element>(sel: string): T {
    const node = this.box.querySelector(sel);
    if (node === null) throw new Error(`Missing progress element: ${sel}`);
    return node as T;
  }

  private css(): void {
    const style = document.createElement("style");
    style.textContent = `
      .vectoriser-progress { display:grid; gap:8px; margin:0 0 14px; padding:12px; border:1px solid var(--vscode-panel-border); border-radius:8px; color:var(--vscode-editor-foreground); background:var(--vscode-sideBar-background); }
      .vectoriser-progress[hidden] { display:none; }
      .vectoriser-progress-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; }
      .vectoriser-progress progress { width:100%; height:9px; accent-color:var(--vscode-progressBar-background, var(--vscode-button-background)); }
      .vectoriser-progress-timing { color:var(--vscode-descriptionForeground); font-size:.86rem; }
    `;
    document.head.append(style);
  }
}

const root = document.getElementById("app");
if (root !== null && !document.body.classList.contains("site-body")) new Prog(root).run();
