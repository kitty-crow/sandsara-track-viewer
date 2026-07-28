import { readFile, writeFile } from "node:fs/promises";

interface Target {
  readonly path: string;
  readonly imports: readonly string[];
  readonly patchTrack?: boolean;
  readonly defaultContours?: boolean;
}

const targets: readonly Target[] = [
  {
    path: "dist/webviews/imageVectoriser.js",
    imports: ["./rangeNumber.js"],
    defaultContours: true
  },
  {
    path: "dist/webviews/svgToTrack.js",
    imports: ["./rangeNumber.js"],
    patchTrack: true
  },
  {
    path: "dist/webviews/trackPreview.js",
    imports: ["./rangeNumber.js", "./trackAnimation.js"]
  },
  {
    path: "dist/site/assets/webview/imageVectoriser.js",
    imports: ["./rangeNumber.js"],
    defaultContours: true
  },
  {
    path: "dist/site/assets/webview/svgToTrack.js",
    imports: ["./rangeNumber.js"],
    patchTrack: true
  },
  {
    path: "dist/site/assets/webview/trackPreview.js",
    imports: ["./rangeNumber.js", "./trackAnimation.js"]
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

  for (const specifier of target.imports) {
    const statement = `import ${JSON.stringify(specifier)};`;
    if (!source.includes(statement)) {
      source = `${source.trimEnd()}\n${statement}\n`;
    }
  }

  await writeFile(target.path, source, "utf8");
}
