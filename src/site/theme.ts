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
const kofiPage = "https://ko-fi.com/kittycrow";
const kofiIcon = "https://storage.ko-fi.com/cdn/cup-border.png";
const media = window.matchMedia("(prefers-color-scheme: dark)");
const wide = window.matchMedia("(min-width: 721px)");
const button = document.querySelector<HTMLButtonElement>("[data-theme-toggle]");
const themeColour = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

const kofiNodes = [
  ".floatingchat-container-wrap",
  ".floatingchat-container-wrap-mobi",
  ".floating-chat-kofi-popup-iframe",
  ".floating-chat-kofi-popup-iframe-mobi",
  ".floating-chat-kofi-popup-iframe-closer",
  ".floating-chat-kofi-popup-iframe-closer-mobi"
].join(",");

const kofiCss = `
.floatingchat-container-wrap,
.floatingchat-container-wrap-mobi {
  position: fixed !important;
  top: var(--kofi-top, 88px) !important;
  right: 16px !important;
  bottom: auto !important;
  left: auto !important;
  width: 230px !important;
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
  width: 230px !important;
  max-width: none !important;
  margin: 0 !important;
  transform: none !important;
}

.floating-chat-kofi-popup-iframe,
.floating-chat-kofi-popup-iframe-mobi,
.floating-chat-kofi-popup-iframe-closer,
.floating-chat-kofi-popup-iframe-closer-mobi {
  right: 16px !important;
  left: auto !important;
  max-width: calc(100vw - 32px) !important;
  z-index: var(--kofi-z, 19) !important;
}

.kofi-footer-link > img {
  display: block;
  width: 1.05rem;
  height: 1.05rem;
  flex: 0 0 auto;
  object-fit: contain;
}

.footer-links .kofi-footer-link::before {
  display: none;
}

@media (max-width: 720px) {
  .floatingchat-container-wrap,
  .floatingchat-container-wrap-mobi {
    position: fixed !important;
    width: 56px !important;
    min-width: 56px !important;
    max-width: 56px !important;
    height: 56px !important;
    min-height: 56px !important;
    max-height: 56px !important;
    aspect-ratio: 1 / 1 !important;
    flex: 0 0 56px !important;
    padding: 0 !important;
    overflow: hidden !important;
    border: 0 !important;
    border-radius: 50% !important;
    box-sizing: border-box !important;
    background: #5bc0de !important;
    box-shadow: 0 8px 20px rgba(31, 49, 56, .22) !important;
    clip-path: circle(50% at 50% 50%) !important;
    transform: none !important;
    isolation: isolate;
  }

  .floatingchat-container-wrap::after,
  .floatingchat-container-wrap-mobi::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 2;
    border-radius: 50%;
    background-color: #5bc0de;
    background-image: url("${kofiIcon}");
    background-position: center;
    background-repeat: no-repeat;
    background-size: 38px auto;
    pointer-events: none;
  }

  .floatingchat-container-wrap > iframe,
  .floatingchat-container-wrap-mobi > iframe {
    position: absolute !important;
    top: 0 !important;
    right: auto !important;
    bottom: auto !important;
    left: 0 !important;
    z-index: 1 !important;
    width: 230px !important;
    height: 56px !important;
    min-height: 56px !important;
    max-width: none !important;
    max-height: 56px !important;
    margin: 0 !important;
    transform: none !important;
    pointer-events: auto !important;
  }
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

function addKofiCss(): void {
  if (document.getElementById("kofi-site-style") !== null) return;

  const style = document.createElement("style");
  style.id = "kofi-site-style";
  style.textContent = kofiCss;
  document.head.appendChild(style);
}

function addFooterKofi(): void {
  const footer = document.querySelector<HTMLElement>(".footer-links");
  if (footer === null || footer.querySelector(".kofi-footer-link") !== null) return;

  const link = document.createElement("a");
  link.className = "kofi-footer-link";
  link.href = kofiPage;
  link.target = "_blank";
  link.rel = "noopener noreferrer";

  const icon = document.createElement("img");
  icon.src = kofiIcon;
  icon.alt = "";

  link.append(icon, "Buy me a coffee");
  footer.appendChild(link);
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

function clearKofi(): void {
  document.querySelectorAll(kofiNodes).forEach(node => node.remove());
}

function drawKofi(): void {
  clearKofi();
  window.kofiWidgetOverlay?.draw("kittycrow", {
    "type": "floating-chat",
    "floating-chat.donateButton.text": wide.matches ? "Buy me a coffee?" : "",
    "floating-chat.donateButton.background-color": "#5bc0de",
    "floating-chat.donateButton.text-color": "#323842"
  });
  queueKofi();
}

function initKofi(): void {
  const head = document.querySelector<HTMLElement>(".site-header");
  if (head === null) return;

  addKofiCss();
  addFooterKofi();
  queueKofi();
  window.addEventListener("resize", queueKofi);
  window.addEventListener("scroll", queueKofi, { passive: true });
  new ResizeObserver(queueKofi).observe(head);
  wide.addEventListener("change", () => requestAnimationFrame(drawKofi));

  const obs = new MutationObserver(queueKofi);
  obs.observe(document.body, { childList: true, subtree: true });
  window.setTimeout(() => obs.disconnect(), 2000);

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
