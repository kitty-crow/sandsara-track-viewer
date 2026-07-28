export {};

const styleId = "sandsara-range-number-style";

installStyle();
enhance(document);

new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node instanceof Element) {
        enhance(node);
      }
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true });

function enhance(root: ParentNode): void {
  const ranges = root instanceof HTMLInputElement && root.type === "range"
    ? [root]
    : [...root.querySelectorAll<HTMLInputElement>('input[type="range"]')];

  for (const range of ranges) {
    if (range.dataset.numberInput === "true") {
      continue;
    }

    const row = range.closest<HTMLElement>(".control-row");
    const display = row?.querySelector<HTMLElement>(".value");
    if (row === null || display === undefined || display === null || display instanceof HTMLInputElement) {
      continue;
    }

    const number = document.createElement("input");
    number.type = "number";
    number.id = display.id;
    number.className = `${display.className} range-number`.trim();
    number.value = range.value;
    number.inputMode = "decimal";
    number.setAttribute("aria-label", `${controlLabel(range)} value`);
    copyAttribute(range, number, "min");
    copyAttribute(range, number, "max");
    copyAttribute(range, number, "step");
    display.replaceWith(number);
    range.dataset.numberInput = "true";

    const fromRange = (): void => {
      number.value = range.value;
    };
    const toRange = (eventName: "input" | "change"): void => {
      if (number.value.trim() === "" || number.validity.badInput) {
        return;
      }
      const value = clampToRange(Number(number.value), range);
      if (!Number.isFinite(value)) {
        return;
      }
      range.value = String(value);
      number.value = range.value;
      range.dispatchEvent(new Event(eventName, { bubbles: true }));
    };

    range.addEventListener("input", fromRange);
    range.addEventListener("change", fromRange);
    number.addEventListener("input", () => toRange("input"));
    number.addEventListener("change", () => toRange("change"));
  }
}

function controlLabel(range: HTMLInputElement): string {
  const direct = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(range.id)}"]`);
  const text = direct?.textContent?.trim();
  return text && text.length > 0 ? text : "Slider";
}

function copyAttribute(
  source: HTMLInputElement,
  target: HTMLInputElement,
  name: "min" | "max" | "step"
): void {
  const value = source.getAttribute(name);
  if (value !== null) {
    target.setAttribute(name, value);
  }
}

function clampToRange(value: number, range: HTMLInputElement): number {
  const minimum = range.min === "" ? Number.NEGATIVE_INFINITY : Number(range.min);
  const maximum = range.max === "" ? Number.POSITIVE_INFINITY : Number(range.max);
  return Math.min(maximum, Math.max(minimum, value));
}

function installStyle(): void {
  if (document.getElementById(styleId) !== null) {
    return;
  }
  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
    .range-number {
      width: 5.8rem !important;
      min-width: 5.8rem;
      padding: 0.35rem 0.45rem !important;
      text-align: right;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 0.35rem;
      font: inherit;
    }
  `;
  document.head.append(style);
}
