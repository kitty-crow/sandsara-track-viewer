import { readFile, writeFile } from "node:fs/promises";

interface Target {
  readonly path: string;
  readonly imports: readonly string[];
  readonly patchTrack?: boolean;
  readonly patchPlayback?: boolean;
  readonly patchSourceReady?: boolean;
  readonly defaultContours?: boolean;
}

interface DynTarget {
  readonly path: string;
  readonly spec: string;
}

const playbackPatch = `
const __sandsaraPlaybackPaneMarker = "sandsara-playback-pane-sync";
void __sandsaraPlaybackPaneMarker;

function __sandsaraInstallPlaybackPaneSync() {
  const pane = document.getElementById("sourcePane");
  if (!(pane instanceof HTMLElement) || pane.dataset.playbackSync === "true") {
    return;
  }

  pane.dataset.playbackSync = "true";
  let sourceOpen = !pane.hidden;

  new MutationObserver(() => {
    const nextOpen = !pane.hidden;
    if (nextOpen === sourceOpen) {
      return;
    }
    sourceOpen = nextOpen;

    if (sourceOpen) {
      const wasRunning = running;
      stop();
      if (wasRunning) {
        setStatus("Paused at " + formatProgress() + ".");
      }
      return;
    }

    if (payload !== undefined && progress > 0) {
      window.setTimeout(render, 0);
    }
  }).observe(pane, {
    attributes: true,
    attributeFilter: ["hidden"]
  });
}

const __sandsaraPlaybackPaneRoot = new MutationObserver(__sandsaraInstallPlaybackPaneSync);
__sandsaraPlaybackPaneRoot.observe(document.documentElement, {
  childList: true,
  subtree: true
});
__sandsaraInstallPlaybackPaneSync();
`;

const targets: readonly Target[] = [
  {
    path: "dist/webviews/imageVectoriser.js",
    imports: ["./rangeNumber.js"],
    defaultContours: true
  },
  {
    path: "dist/webviews/svgToTrack.js",
    imports: ["./rangeNumber.js", "./autoSetup.js"],
    patchTrack: true
  },
  {
    path: "dist/webviews/trackPreview.js",
    imports: ["./rangeNumber.js", "./trackAnimation.js"],
    patchSourceReady: true
  },
  {
    path: "dist/webviews/trackAnimation.js",
    imports: [],
    patchPlayback: true
  },
  {
    path: "dist/site/assets/webview/imageVectoriser.js",
    imports: ["./rangeNumber.js"],
    defaultContours: true
  },
  {
    path: "dist/site/assets/webview/svgToTrack.js",
    imports: ["./rangeNumber.js", "./autoSetup.js"],
    patchTrack: true
  },
  {
    path: "dist/site/assets/webview/trackPreview.js",
    imports: ["./rangeNumber.js", "./trackAnimation.js"],
    patchSourceReady: true
  },
  {
    path: "dist/site/assets/webview/trackAnimation.js",
    imports: [],
    patchPlayback: true
  }
];

const dyns: readonly DynTarget[] = [
  {
    path: "dist/site/assets/site/vectorise.js",
    spec: "../webview/imageVectoriser"
  },
  {
    path: "dist/site/assets/site/generate.js",
    spec: "../webview/svgToTrack"
  },
  {
    path: "dist/site/assets/site/visualise.js",
    spec: "../webview/trackPreview"
  }
];

for (const target of targets) {
  let source = await readFile(target.path, "utf8");

  if (target.defaultContours === true) {
    const oldOption = '<option value="silhouette">Black-and-white contours</option>';
    const newOption = '<option value="silhouette" selected>Black-and-white contours</option>';
    if (!source.includes(oldOption) && !source.includes(newOption)) {
      throw new Error(`${target.path}: contour method option was not found`);
    }
    source = source.replaceAll(oldOption, newOption);
  }

  if (target.patchTrack === true) {
    const oldColour = 'styles.getPropertyValue("--vscode-editor-foreground")';
    const newColour = '(styles.getPropertyValue("--sandsara-track-line").trim() || styles.getPropertyValue("--vscode-editor-foreground"))';
    if (!source.includes(oldColour) && !source.includes(newColour)) {
      throw new Error(`${target.path}: track colour expression was not found`);
    }
    if (!source.includes(newColour)) {
      source = source.replaceAll(oldColour, newColour);
    }

    const oldWidth = "Math.max(1, ratio * 0.7)";
    const newWidth = "Math.max(1.4, ratio * 1.1)";
    if (!source.includes(oldWidth) && !source.includes(newWidth)) {
      throw new Error(`${target.path}: track line width expression was not found`);
    }
    source = source.replaceAll(oldWidth, newWidth);
  }

  if (target.patchPlayback === true) {
    if (!source.includes("__sandsaraPlaybackPaneMarker")) {
      source = `${source.trimEnd()}\n${playbackPatch.trim()}\n`;
    }
    if (
      !source.includes("__sandsaraPlaybackPaneMarker") ||
      !source.includes("const wasRunning = running;") ||
      !source.includes("window.setTimeout(render, 0);")
    ) {
      throw new Error(`${target.path}: playback pane synchronisation was not installed`);
    }
  }

  if (target.patchSourceReady === true) {
    const readyPattern = /if \(!busy\)\s+sourceProgress\.value = 0;/;
    if (!readyPattern.test(source) && !source.includes("setSourceButtons(sourceReady);")) {
      throw new Error(`${target.path}: source-ready button transition was not found`);
    }
    source = source.replace(
      readyPattern,
      "if (!busy) {\n        sourceProgress.value = 0;\n        setSourceButtons(sourceReady);\n    }"
    );
    if (!source.includes("setSourceButtons(sourceReady);")) {
      throw new Error(`${target.path}: source actions remain disabled after loading`);
    }
  }

  for (const specifier of target.imports) {
    const statement = `import ${JSON.stringify(specifier)};`;
    if (!source.includes(statement)) {
      source = `${source.trimEnd()}\n${statement}\n`;
    }
  }

  await writeFile(target.path, source, "utf8");
}

for (const target of dyns) {
  let source = await readFile(target.path, "utf8");
  const oldImport = `import(${JSON.stringify(target.spec)})`;
  const newImport = `import(${JSON.stringify(`${target.spec}.js`)})`;

  if (!source.includes(oldImport) && !source.includes(newImport)) {
    throw new Error(`${target.path}: dynamic browser import was not found`);
  }

  source = source.replaceAll(oldImport, newImport);
  if (source.includes(oldImport) || !source.includes(newImport)) {
    throw new Error(`${target.path}: dynamic browser import remains extensionless`);
  }

  await writeFile(target.path, source, "utf8");
}

const cssPath = "dist/site/studio-extra.css";
let css = await readFile(cssPath, "utf8");
const oldAbout = '.footer-links a[href="./about.html"]::before {';
const newAbout = '.footer-links a[href="./about"]::before,\n.footer-links a[href="./about.html"]::before {';

if (!css.includes(oldAbout) && !css.includes(newAbout)) {
  throw new Error(`${cssPath}: About icon selector was not found`);
}

css = css.replaceAll(oldAbout, newAbout);
if (!css.includes(newAbout)) {
  throw new Error(`${cssPath}: clean About route has no icon selector`);
}

await writeFile(cssPath, css, "utf8");

const previewTargets = [
  "dist/webviews/trackPreview.js",
  "dist/site/assets/webview/trackPreview.js"
] as const;
const previewTokens = [
  'id="sourceProgress"',
  'id="sourceLoadPercent"',
  'classList.toggle("source-busy"',
  'setSourceProgress(100, "Track source ready.")',
  'setSourceButtons(sourceReady);',
  'void prepareSource()'
] as const;

for (const path of previewTargets) {
  const source = await readFile(path, "utf8");
  for (const token of previewTokens) {
    if (!source.includes(token)) {
      throw new Error(`${path}: missing track source loading feedback ${JSON.stringify(token)}`);
    }
  }
}
