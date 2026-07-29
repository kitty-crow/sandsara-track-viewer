type Theme = "light" | "dark";

type Kofi = Readonly<{
  draw: (name: string, cfg: Readonly<Record<string, string>>) => void;
}>;

declare global {
  interface Window {
    kofiWidgetOverlay?: Kofi;
  }
}

const storageKey = "sandsara.theme";
const kofiSrc = "https://storage.ko-fi.com/cdn/scripts/overlay-widget.js";
const media = window.matchMedia("(prefers-color-scheme: dark)");
const button = document.querySelector<HTMLButtonElement>("[data-theme-toggle]");
const themeColour = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

const kofiCss = `
.floatingchat-container-wrap,
.floatingchat-container-wrap-mobi {
  position: fixed !important;
  top: var(--kofi-top, 88px) !important;
  right: 16px !important;
  bottom: auto !important;
  left: auto !important;
  width: min(230px, calc(100vw - 32px)) !important;
  max-width: calc(100vw - 32px) !important;
  overflow: visible !important;
  transform: none !important;
  z-index: var(--kofi-z, 19) !important;
}

.floatingchat-container-wrap > iframe,
.floatingchat-container-wrap-mobi > iframe {
  position: static !important;
  inset: auto !important;
  display: block !important;
  width: 100% !important;
  max-width: 100% !important;
  margin: 0 !important;
  transform: none !important;
}

.floating-chat-kofi-popup-iframe,
.floating-chat-kofi-popup-iframe-mobi,
.floating-chat-kofi-popup-iframe-closer,
.floating-chat-kofi-popup-iframe-closer-mobi {
  z-index: var(--kofi-z, 19) !important;
}
`;

let kofiFrame = 0;

function storedTheme(): Theme | undefined {
  const value = localStorage.getItem(storageKey);
  return value === "light" || value === "dark" ? value : undefined;
}

function preferredTheme(): Theme {
  return media.matches ? "dark" : "light";
}

function activeTheme(): Theme {
  return storedTheme() ?? preferredTheme();
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;

  if (themeColour !== null) {
    themeColour.content = theme === "dark" ? "#18211d" : "#f3eee4";
  }

  if (button !== null) {
    const dark = theme === "dark";
    button.textContent = dark ? "🌙" : "☀️";
    button.setAttribute("aria-label", dark ? "Dark mode enabled. Switch to light mode" : "Light mode enabled. Switch to dark mode");
    button.setAttribute("title", dark ? "Dark mode enabled" : "Light mode enabled");
    button.setAttribute("aria-pressed", String(dark));
  }
}

function hasKofi(): boolean {
  return document.querySelector(".floatingchat-container-wrap, .floatingchat-container-wrap-mobi") !== null;
}

function placeKofi(): void {
  const head = document.querySelector<HTMLElement>(".site-header");
  if (head === null) return;

  const top = Math.max(12, Math.ceil(head.getBoundingClientRect().bottom + 12));
  const parsed = Number.parseInt(getComputedStyle(head).zIndex, 10);
  const z = Number.isFinite(parsed) ? Math.max(0, parsed - 1) : 19;

  document.documentElement.style.setProperty("--kofi-top", `${top}px`);
  document.documentElement.style.setProperty("--kofi-z", String(z));
}

function queueKofi(): void {
  cancelAnimationFrame(kofiFrame);
  kofiFrame = requestAnimationFrame(placeKofi);
}

function addKofiCss(): void {
  if (document.getElementById("kofi-site-style") !== null) return;

  const style = document.createElement("style");
  style.id = "kofi-site-style";
  style.textContent = kofiCss;
  document.head.appendChild(style);
}

function drawKofi(): void {
  if (hasKofi()) {
    queueKofi();
    return;
  }

  window.kofiWidgetOverlay?.draw("kittycrow", {
    "type": "floating-chat",
    "floating-chat.donateButton.text": "Buy me a coffee?",
    "floating-chat.donateButton.background-color": "#5bc0de",
    "floating-chat.donateButton.text-color": "#323842"
  });
  queueKofi();
}

function initKofi(): void {
  const head = document.querySelector<HTMLElement>(".site-header");
  if (head === null) return;

  addKofiCss();
  queueKofi();
  window.addEventListener("resize", queueKofi);
  window.addEventListener("scroll", queueKofi, { passive: true });
  new ResizeObserver(queueKofi).observe(head);

  const obs = new MutationObserver(() => {
    if (!hasKofi()) return;
    queueKofi();
    obs.disconnect();
  });
  obs.observe(document.body, { childList: true, subtree: true });

  if (hasKofi()) return;
  if (window.kofiWidgetOverlay) {
    drawKofi();
    return;
  }

  const old = document.querySelector<HTMLScriptElement>(`script[src="${kofiSrc}"]`);
  if (old !== null) {
    old.addEventListener("load", drawKofi, { once: true });
    return;
  }

  const script = document.createElement("script");
  script.src = kofiSrc;
  script.addEventListener("load", drawKofi, { once: true });
  document.body.appendChild(script);
}

button?.addEventListener("click", () => {
  const next: Theme = activeTheme() === "dark" ? "light" : "dark";
  localStorage.setItem(storageKey, next);
  applyTheme(next);
});

media.addEventListener("change", () => {
  if (storedTheme() === undefined) {
    applyTheme(preferredTheme());
  }
});

applyTheme(activeTheme());
initKofi();

export {};
