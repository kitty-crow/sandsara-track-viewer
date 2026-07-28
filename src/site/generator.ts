export {};

type FrameId = "img2svg" | "svg2bin";

interface FrameSizeMessage {
  readonly type: "sandsara-frame-height";
  readonly frame: FrameId;
  readonly height: number;
}

interface SvgReadyMessage {
  readonly type: "sandsara-svg-ready";
  readonly svg: string;
  readonly filename: string;
}

const imgFrame = frame("imgFrame");
const svgFrame = frame("svgFrame");
const steps = new Map<FrameId, HTMLElement>([
  ["img2svg", element('[data-flow-step="img2svg"]')],
  ["svg2bin", element('[data-flow-step="svg2bin"]')]
]);
const states = new Map<FrameId, HTMLElement>([
  ["img2svg", element('[data-step-state="img2svg"]')],
  ["svg2bin", element('[data-step-state="svg2bin"]')]
]);
const links = new Map<FrameId, HTMLAnchorElement>([
  ["img2svg", anchor('[data-flow-link="img2svg"]')],
  ["svg2bin", anchor('[data-flow-link="svg2bin"]')]
]);

for (const [id, target] of [["img2svg", imgFrame], ["svg2bin", svgFrame]] as const) {
  target.addEventListener("load", () => watchFrame(id, target));
}

window.addEventListener("message", event => {
  const source = event.source;
  const frameId = source === imgFrame.contentWindow
    ? "img2svg"
    : source === svgFrame.contentWindow
      ? "svg2bin"
      : undefined;

  if (frameId === undefined || typeof event.data !== "object" || event.data === null) {
    return;
  }

  if (isFrameSize(event.data) && event.data.frame === frameId) {
    const height = Math.max(320, Math.min(6_000, Math.ceil(event.data.height)));
    const target = frameId === "img2svg" ? imgFrame : svgFrame;
    target.style.height = `${height}px`;
    return;
  }

  if (frameId === "img2svg" && isSvgReady(event.data)) {
    sessionStorage.setItem("sandsara.pendingSvg", event.data.svg);
    sessionStorage.setItem("sandsara.pendingSvgFilename", event.data.filename);
    complete("img2svg", "SVG ready. Continuing to the track builder.");
    states.get("svg2bin")!.textContent = `Opening “${event.data.filename}”…`;
    svgFrame.src = `./parts/svg2bin.html?source=${Date.now()}`;
    history.replaceState(history.state, "", "#svg2bin");
    window.setTimeout(() => {
      document.getElementById("svg2bin")?.scrollIntoView({
        behavior: reducedMotion() ? "auto" : "smooth",
        block: "start"
      });
    }, 80);
  }
});

const observer = new IntersectionObserver(entries => {
  const visible = entries
    .filter(entry => entry.isIntersecting)
    .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (visible?.target.id === "img2svg" || visible?.target.id === "svg2bin") {
    select(visible.target.id);
  }
}, {
  rootMargin: "-20% 0px -55%",
  threshold: [0.1, 0.35, 0.65]
});

for (const id of ["img2svg", "svg2bin"] as const) {
  const section = document.getElementById(id);
  if (section !== null) {
    observer.observe(section);
  }
}

window.addEventListener("hashchange", () => {
  if (window.location.hash === "#svg2bin") {
    select("svg2bin");
  } else if (window.location.hash === "#img2svg") {
    select("img2svg");
  }
});

select(window.location.hash === "#svg2bin" ? "svg2bin" : "img2svg");

function watchFrame(id: FrameId, target: HTMLIFrameElement): void {
  const doc = target.contentDocument;
  if (doc === null) {
    return;
  }

  const resize = (): void => {
    const height = Math.ceil(Math.max(
      doc.documentElement.scrollHeight,
      doc.body?.scrollHeight ?? 0
    ));
    target.style.height = `${Math.max(320, Math.min(6_000, height))}px`;
  };

  const status = doc.getElementById("siteStatus");
  if (status !== null) {
    const update = (): void => {
      const text = status.textContent?.trim();
      if (text) {
        states.get(id)!.textContent = text;
        if (id === "svg2bin" && text.startsWith("Track ready")) {
          steps.get(id)?.classList.add("complete");
        }
      }
      resize();
    };
    new MutationObserver(update).observe(status, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true
    });
    update();
  } else {
    resize();
  }
}

function complete(id: FrameId, text: string): void {
  steps.get(id)?.classList.add("complete");
  const state = states.get(id);
  if (state !== undefined) {
    state.textContent = text;
  }
}

function select(id: FrameId): void {
  for (const [key, link] of links) {
    if (key === id) {
      link.setAttribute("aria-current", "step");
    } else {
      link.removeAttribute("aria-current");
    }
  }
}

function isFrameSize(value: object): value is FrameSizeMessage {
  return "type" in value &&
    value.type === "sandsara-frame-height" &&
    "frame" in value &&
    (value.frame === "img2svg" || value.frame === "svg2bin") &&
    "height" in value &&
    typeof value.height === "number" &&
    Number.isFinite(value.height);
}

function isSvgReady(value: object): value is SvgReadyMessage {
  return "type" in value &&
    value.type === "sandsara-svg-ready" &&
    "svg" in value &&
    typeof value.svg === "string" &&
    "filename" in value &&
    typeof value.filename === "string";
}

function frame(id: string): HTMLIFrameElement {
  const value = document.getElementById(id);
  if (!(value instanceof HTMLIFrameElement)) {
    throw new Error(`Missing generator frame: ${id}`);
  }
  return value;
}

function element(selector: string): HTMLElement {
  const value = document.querySelector(selector);
  if (!(value instanceof HTMLElement)) {
    throw new Error(`Missing generator element: ${selector}`);
  }
  return value;
}

function anchor(selector: string): HTMLAnchorElement {
  const value = document.querySelector(selector);
  if (!(value instanceof HTMLAnchorElement)) {
    throw new Error(`Missing generator link: ${selector}`);
  }
  return value;
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
