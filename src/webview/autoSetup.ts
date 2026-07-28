export {};

type Mode = "auto" | "manual";
type Stage = "img" | "trk";

interface Tbl {
  readonly id: string;
  readonly name: string;
  readonly dia: number;
  readonly balls: readonly number[];
}

interface State {
  readonly mode: Mode;
  readonly tbl: string;
  readonly ball: string;
  readonly dia: number;
  readonly ballDia: number;
}

interface Profile {
  readonly name: string;
  readonly dia: number;
  readonly ball: number;
  readonly custom: boolean;
}

const storeKey = "sandsara.auto-setup.v1";
const channelName = "sandsara-auto-setup";
const tbls: readonly Tbl[] = [
  { id: "mini", name: "Mini / Mini Pro · 188 mm drawing area", dia: 188, balls: [6, 8] },
  { id: "wireless", name: "Wireless / Original · 292 mm drawing area", dia: 292, balls: [8, 12] },
  { id: "round62", name: "Round 62 · 560 mm drawing area", dia: 560, balls: [8, 12] },
  { id: "round80", name: "Round 80 · 760 mm drawing area", dia: 760, balls: [8, 12] }
];

const imgIds = [
  "algorithm",
  "contrast",
  "threshold",
  "autoThreshold",
  "blur",
  "simplify",
  "minimumLength",
  "maximumDimension"
] as const;
const trkIds = ["sampleSpacing", "simplify", "trackSpacing", "padding"] as const;

let panel: HTMLElement | undefined;
let stage: Stage | undefined;
let applying = false;
let channel: BroadcastChannel | undefined;

try {
  channel = new BroadcastChannel(channelName);
  channel.addEventListener("message", () => sync(true));
} catch {
  channel = undefined;
}

installStyle();
install();
new MutationObserver(install).observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("storage", event => {
  if (event.key === storeKey) sync(true);
});

function install(): void {
  if (panel !== undefined) return;

  const controls = document.querySelector<HTMLElement>(".controls");
  stage = detectStage();
  if (controls === null || stage === undefined) return;

  panel = makePanel();
  controls.prepend(panel);
  bind(controls);
  sync(true);

  const mount = document.getElementById("svgMount");
  if (stage === "trk" && mount !== null) {
    new MutationObserver(() => {
      const state = read();
      if (state.mode === "auto" && profile(state) !== undefined) apply(state);
    }).observe(mount, { childList: true, subtree: true });
  }
}

function detectStage(): Stage | undefined {
  if (document.getElementById("algorithm") !== null) return "img";
  if (document.getElementById("sampleSpacing") !== null) return "trk";
  return undefined;
}

function makePanel(): HTMLElement {
  const node = document.createElement("section");
  node.className = "auto-setup";
  node.setAttribute("aria-labelledby", "autoSetupTitle");
  node.innerHTML = `
    <div class="auto-head">
      <div>
        <strong id="autoSetupTitle">Automatic fit</strong>
        <span>Match detail to the physical table and ball.</span>
      </div>
      <select id="autoMode" aria-label="Generator setup mode">
        <option value="auto">Auto · recommended</option>
        <option value="manual">Manual</option>
      </select>
    </div>
    <div class="auto-grid">
      <label>Table
        <select id="autoTable">
          <option value="">Choose your Sandsara…</option>
          <option value="custom">Custom circular canvas…</option>
        </select>
      </label>
      <label id="autoDiaRow" hidden>Drawing diameter
        <span class="auto-unit"><input id="autoDia" type="number" min="50" max="3000" step="1" inputmode="decimal"><span>mm</span></span>
      </label>
      <label>Ball size
        <select id="autoBall" disabled>
          <option value="">Choose the ball…</option>
        </select>
      </label>
      <label id="autoBallDiaRow" hidden>Ball diameter
        <span class="auto-unit"><input id="autoBallDia" type="number" min="2" max="40" step="0.1" inputmode="decimal"><span>mm</span></span>
      </label>
      <button id="autoApply" type="button" disabled>Apply Auto</button>
    </div>
    <p id="autoStatus" class="auto-status" aria-live="polite"></p>
  `;

  const table = req<HTMLSelectElement>(node, "autoTable");
  const custom = table.querySelector<HTMLOptionElement>('option[value="custom"]');
  for (const item of tbls) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    table.insertBefore(option, custom);
  }
  return node;
}

function bind(controls: HTMLElement): void {
  const mode = req<HTMLSelectElement>(panel, "autoMode");
  const table = req<HTMLSelectElement>(panel, "autoTable");
  const ball = req<HTMLSelectElement>(panel, "autoBall");
  const dia = req<HTMLInputElement>(panel, "autoDia");
  const ballDia = req<HTMLInputElement>(panel, "autoBallDia");
  const applyButton = req<HTMLButtonElement>(panel, "autoApply");

  mode.addEventListener("change", changed);
  table.addEventListener("change", () => {
    fillBalls(ball, table.value, "");
    changed();
  });
  ball.addEventListener("change", changed);
  dia.addEventListener("input", changed);
  dia.addEventListener("change", changed);
  ballDia.addEventListener("input", changed);
  ballDia.addEventListener("change", changed);
  applyButton.addEventListener("click", () => apply(readPanel()));

  controls.addEventListener("input", event => {
    if (applying || !(event.target instanceof HTMLElement)) return;
    const ids = stage === "img" ? imgIds : trkIds;
    if (ids.includes(event.target.id as never) && readPanel().mode === "auto") {
      note("Automatic values adjusted manually. Select Apply Auto to restore the calculated baseline.");
    }
  });

  function changed(): void {
    const state = readPanel();
    write(state);
    sync(state.mode === "auto");
  }
}

function sync(run: boolean): void {
  if (panel === undefined) return;

  const state = read();
  const mode = req<HTMLSelectElement>(panel, "autoMode");
  const table = req<HTMLSelectElement>(panel, "autoTable");
  const ball = req<HTMLSelectElement>(panel, "autoBall");
  const dia = req<HTMLInputElement>(panel, "autoDia");
  const ballDia = req<HTMLInputElement>(panel, "autoBallDia");
  const applyButton = req<HTMLButtonElement>(panel, "autoApply");

  mode.value = state.mode;
  table.value = state.tbl === "custom" || tableById(state.tbl) !== undefined ? state.tbl : "";
  dia.value = fmt(state.dia);
  fillBalls(ball, table.value, state.ball);
  ballDia.value = fmt(state.ballDia);

  const auto = state.mode === "auto";
  const p = profile(state);
  table.disabled = !auto;
  ball.disabled = !auto || table.value === "";
  dia.disabled = !auto;
  ballDia.disabled = !auto;
  req<HTMLElement>(panel, "autoDiaRow").hidden = table.value !== "custom";
  req<HTMLElement>(panel, "autoBallDiaRow").hidden = ball.value !== "custom";
  applyButton.disabled = !auto || p === undefined;
  lock(auto && p !== undefined);

  if (!auto) {
    note("Manual mode leaves every generator control available.");
  } else if (p === undefined) {
    note("Choose a table and ball, or enter custom millimetre dimensions.");
  } else if (run) {
    apply(state);
  }
}

function apply(state: State): void {
  const p = profile(state);
  if (p === undefined || stage === undefined) return;

  applying = true;
  try {
    if (stage === "img") applyImg(p);
    else applyTrk(p);
  } finally {
    applying = false;
  }
}

function applyImg(p: Profile): void {
  const cells = p.dia / p.ball;
  const res = snap(clamp(cells * 16, 384, 1536), 64);
  const ballPx = p.ball * res / p.dia;
  const blur = cells < 26 ? 2 : 1;
  const simp = snap(clamp(ballPx * 0.11, 0.75, 5), 0.25);
  const min = snap(clamp(ballPx * 1.25, 8, 120), 1);

  setSelect("algorithm", "silhouette");
  setCheck("autoThreshold", true);
  setVal("contrast", 1.8);
  setVal("threshold", 92);
  setVal("blur", blur);
  setVal("simplify", simp);
  setVal("minimumLength", min);
  setVal("maximumDimension", res);

  note(
    `${profileName(p)} · about ${Math.round(cells)} ball widths across. ` +
    `Auto uses ${res} px processing, ${fmt(simp)} simplification and a ${fmt(min)} px minimum feature.`
  );
}

function applyTrk(p: Profile): void {
  const source = svgDim() ?? snap(clamp(p.dia / p.ball * 16, 384, 1536), 64);
  const ballSvg = p.ball * source / p.dia;
  const sample = snap(clamp(ballSvg / 6, 0.25, 12), 0.25);
  const simp = snap(clamp(ballSvg / 12, 0, 8), 0.25);
  const spacing = snap(clamp(65_534 * p.ball / p.dia * 0.14, 60, 800), 10);
  const overscan = snap(clamp(-(p.ball + 2) / p.dia, -0.2, -0.01), 0.01);

  setVal("sampleSpacing", sample);
  setVal("simplify", simp);
  setVal("trackSpacing", spacing);
  setVal("padding", overscan);

  note(
    `${profileName(p)}. Auto uses ${fmt(sample)} SVG sampling, ${fmt(spacing)} Sandsara point spacing ` +
    `and a ${fmt(Math.abs(overscan * 100))}% edge inset.`
  );
}

function lock(value: boolean): void {
  const ids = stage === "img" ? imgIds : trkIds;
  for (const id of ids) {
    const control = document.getElementById(id);
    if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
      control.disabled = value;
      const number = control.closest<HTMLElement>(".control-row")
        ?.querySelector<HTMLInputElement>(".range-number");
      if (number !== undefined && number !== null) number.disabled = value;
    }
  }
}

function fillBalls(select: HTMLSelectElement, tableId: string, selected: string): void {
  const item = tableById(tableId);
  const sizes = item?.balls ?? (tableId === "custom" ? [6, 8, 12] : []);
  select.replaceChildren(new Option("Choose the ball…", ""));
  for (const size of sizes) select.add(new Option(`${size} mm`, String(size)));
  if (tableId !== "") select.add(new Option("Custom ball…", "custom"));
  select.value = [...select.options].some(option => option.value === selected) ? selected : "";
}

function profile(state: State): Profile | undefined {
  const item = tableById(state.tbl);
  const dia = state.tbl === "custom" ? state.dia : item?.dia;
  const ball = state.ball === "custom" ? state.ballDia : Number(state.ball);
  if (dia === undefined || !Number.isFinite(dia) || dia < 50 || dia > 3000) return undefined;
  if (!Number.isFinite(ball) || ball < 2 || ball > 40 || ball >= dia / 2) return undefined;
  return {
    name: item?.name.split(" · ")[0] ?? "Custom canvas",
    dia,
    ball,
    custom: state.tbl === "custom" || state.ball === "custom"
  };
}

function profileName(p: Profile): string {
  return `${p.name} · ${fmt(p.dia)} mm canvas · ${fmt(p.ball)} mm ball`;
}

function tableById(id: string): Tbl | undefined {
  return tbls.find(item => item.id === id);
}

function readPanel(): State {
  if (panel === undefined) return read();
  return {
    mode: req<HTMLSelectElement>(panel, "autoMode").value === "manual" ? "manual" : "auto",
    tbl: req<HTMLSelectElement>(panel, "autoTable").value,
    ball: req<HTMLSelectElement>(panel, "autoBall").value,
    dia: num(req<HTMLInputElement>(panel, "autoDia").value, 292),
    ballDia: num(req<HTMLInputElement>(panel, "autoBallDia").value, 8)
  };
}

function read(): State {
  const fallback: State = { mode: "auto", tbl: "", ball: "", dia: 292, ballDia: 8 };
  try {
    const raw = localStorage.getItem(storeKey);
    if (raw === null) return fallback;
    const value = JSON.parse(raw) as Partial<State>;
    return {
      mode: value.mode === "manual" ? "manual" : "auto",
      tbl: typeof value.tbl === "string" ? value.tbl : "",
      ball: typeof value.ball === "string" ? value.ball : "",
      dia: typeof value.dia === "number" ? value.dia : 292,
      ballDia: typeof value.ballDia === "number" ? value.ballDia : 8
    };
  } catch {
    return fallback;
  }
}

function write(state: State): void {
  try {
    localStorage.setItem(storeKey, JSON.stringify(state));
  } catch {
    // The active webview can still use the current values without persistence.
  }
  channel?.postMessage(state);
}

function setVal(id: string, value: number): void {
  const input = document.getElementById(id);
  if (!(input instanceof HTMLInputElement)) return;
  const next = String(value);
  if (input.value === next) return;
  input.value = next;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function setSelect(id: string, value: string): void {
  const select = document.getElementById(id);
  if (!(select instanceof HTMLSelectElement) || select.value === value) return;
  select.value = value;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function setCheck(id: string, checked: boolean): void {
  const input = document.getElementById(id);
  if (!(input instanceof HTMLInputElement) || input.checked === checked) return;
  input.checked = checked;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function svgDim(): number | undefined {
  const svg = document.querySelector<SVGSVGElement>("#svgMount svg");
  if (svg === null) return undefined;
  const viewBox = svg.viewBox.baseVal;
  const value = Math.max(viewBox.width, viewBox.height, svg.width.baseVal.value, svg.height.baseVal.value);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function note(text: string): void {
  if (panel !== undefined) req<HTMLElement>(panel, "autoStatus").textContent = text;
}

function req<T extends HTMLElement>(root: ParentNode | undefined, id: string): T {
  const node = root?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
  if (node === undefined || node === null) throw new Error(`Missing automatic setup control: ${id}`);
  return node as T;
}

function num(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function snap(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function installStyle(): void {
  if (document.getElementById("sandsaraAutoSetupStyle") !== null) return;
  const style = document.createElement("style");
  style.id = "sandsaraAutoSetupStyle";
  style.textContent = `
    .auto-setup {
      display: grid;
      gap: 0.8rem;
      padding: 0.9rem;
      border: 1px solid var(--vscode-focusBorder, var(--vscode-panel-border));
      border-radius: 0.7rem;
      background: color-mix(in srgb, var(--vscode-button-background) 10%, var(--vscode-editor-background));
    }
    .auto-head {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 0.8rem;
    }
    .auto-head > div { display: grid; gap: 0.2rem; }
    .auto-head span, .auto-status { color: var(--vscode-descriptionForeground); font-size: 0.88rem; }
    .auto-head select { width: auto; min-width: 9.5rem; }
    .auto-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.65rem; }
    .auto-grid label { display: grid; gap: 0.35rem; font-size: 0.9rem; }
    .auto-grid button { align-self: end; }
    .auto-unit { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 0.4rem; }
    .auto-unit input { min-width: 0; }
    .auto-status { margin: 0; line-height: 1.45; }
    .auto-setup[data-mode="manual"] { border-color: var(--vscode-panel-border); }
    @media (max-width: 520px) {
      .auto-head { display: grid; }
      .auto-head select { width: 100%; }
      .auto-grid { grid-template-columns: 1fr; }
    }
  `;
  document.head.append(style);
}
