const ids = ["applySource", "saveSource", "resetSource", "normaliseSource"] as const;

let queued = false;

function sync(): void {
  queued = false;

  const input = document.getElementById("sourceInput");
  const card = document.getElementById("editorCard");
  if (!(input instanceof HTMLTextAreaElement) || !(card instanceof HTMLElement)) return;

  const apply = button(ids[0]);
  const save = button(ids[1]);
  const reset = button(ids[2]);
  const normalise = button(ids[3]);
  if (apply === null || save === null || reset === null || normalise === null) return;

  const state = card.dataset.state ?? "empty";
  const dirty = document.body.dataset.trackDirty === "true";
  const locked = input.disabled || document.body.classList.contains("source-busy") ||
    state === "loading" || state === "saving";

  setDisabled(apply, locked || !dirty);
  setDisabled(save, locked);
  setDisabled(reset, locked || !dirty);
  setDisabled(normalise, locked);
}

function queue(): void {
  if (queued) return;
  queued = true;
  window.queueMicrotask(sync);
}

function button(id: string): HTMLButtonElement | null {
  const value = document.getElementById(id);
  return value instanceof HTMLButtonElement ? value : null;
}

function setDisabled(button: HTMLButtonElement, disabled: boolean): void {
  if (button.disabled !== disabled) button.disabled = disabled;
}

new MutationObserver(queue).observe(document.documentElement, {
  attributes: true,
  childList: true,
  subtree: true,
  attributeFilter: ["class", "data-state", "data-track-dirty", "disabled", "hidden"]
});

document.addEventListener("input", queue, true);
window.addEventListener("message", queue);
queue();

export {};
