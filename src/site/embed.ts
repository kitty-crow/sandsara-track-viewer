export {};

type FrameId = "img2svg" | "svg2bin";

const frame = document.body.dataset.frame;
if (frame !== "img2svg" && frame !== "svg2bin") {
  throw new Error("The embedded tool frame identifier is missing.");
}

let lastHeight = 0;
let pending = false;

const sendHeight = (): void => {
  pending = false;
  const height = Math.ceil(Math.max(
    document.documentElement.scrollHeight,
    document.body.scrollHeight
  ));
  if (height === lastHeight) {
    return;
  }
  lastHeight = height;
  window.parent.postMessage({
    type: "sandsara-frame-height",
    frame: frame as FrameId,
    height
  }, "*");
};

const scheduleHeight = (): void => {
  if (pending) {
    return;
  }
  pending = true;
  window.requestAnimationFrame(sendHeight);
};

new ResizeObserver(scheduleHeight).observe(document.body);
new MutationObserver(scheduleHeight).observe(document.body, {
  attributes: true,
  childList: true,
  subtree: true,
  characterData: true
});
window.addEventListener("load", scheduleHeight);
window.addEventListener("resize", scheduleHeight);
scheduleHeight();
