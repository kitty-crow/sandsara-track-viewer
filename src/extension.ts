import { randomBytes } from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";
import type {
  FlatTrackPayload,
  ImageVectoriserHostMessage,
  SvgToTrackHostMessage,
  TrackPreviewHostMessage
} from "./messages";
import {
  decodeSandsaraTrack,
  encodeSandsaraTrack,
  pointsFromFlatArray
} from "./sandsara";

const TRACK_VIEW_TYPE = "sandsara.trackPreview";
const TOOLS_VIEW_ID = "sandsara.tools";
const VECTORISE_COMMAND = "sandsara.vectoriseImage";
const SVG_TO_TRACK_COMMAND = "sandsara.svgToTrack";
const OPEN_TRACK_COMMAND = "sandsara.openTrack";
const TRACKS_DIRECTORY_NAME = "tracks";

class SandsaraDocument implements vscode.CustomDocument {
  public constructor(public readonly uri: vscode.Uri) {}

  public dispose(): void {
    // The document owns no disposable resources.
  }
}

class SandsaraEditorProvider
implements vscode.CustomReadonlyEditorProvider<SandsaraDocument> {
  public constructor(private readonly extensionUri: vscode.Uri) {}

  public async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): Promise<SandsaraDocument> {
    return new SandsaraDocument(uri);
  }

  public async resolveCustomEditor(
    document: SandsaraDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    configureWebview(panel.webview, this.extensionUri);

    try {
      const bytes = await vscode.workspace.fs.readFile(document.uri);
      const track = decodeSandsaraTrack(bytes);
      const payload = createPreviewPayload(document.uri, track);

      panel.webview.html = createWebviewHtml(
        panel.webview,
        this.extensionUri,
        "Sandsara Track Preview",
        "trackPreview.js"
      );

      panel.webview.onDidReceiveMessage((message: unknown) => {
        if (!isMessageType(message, "ready")) {
          return;
        }

        const outgoing: TrackPreviewHostMessage = {
          type: "track",
          payload
        };
        void panel.webview.postMessage(outgoing);
      });
    } catch (error: unknown) {
      panel.webview.html = createErrorHtml(toErrorMessage(error));
    }
  }
}

class EmptyToolsProvider implements vscode.TreeDataProvider<never> {
  public getTreeItem(element: never): vscode.TreeItem {
    return element;
  }

  public getChildren(): never[] {
    return [];
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const editorProvider = new SandsaraEditorProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      TRACK_VIEW_TYPE,
      editorProvider,
      { supportsMultipleEditorsPerDocument: true }
    ),
    vscode.window.registerTreeDataProvider(
      TOOLS_VIEW_ID,
      new EmptyToolsProvider()
    ),
    vscode.commands.registerCommand(
      VECTORISE_COMMAND,
      async (resource?: vscode.Uri) => vectoriseImage(context, resource)
    ),
    vscode.commands.registerCommand(
      SVG_TO_TRACK_COMMAND,
      async (resource?: vscode.Uri) => convertSvgToTrack(context, resource)
    ),
    vscode.commands.registerCommand(
      OPEN_TRACK_COMMAND,
      async (resource?: vscode.Uri) => openTrack(resource)
    ),
    createStatusBarButton(
      "$(symbol-color) Vectorise Image",
      "Vectorise a raster image into line-based SVG artwork",
      VECTORISE_COMMAND,
      102
    ),
    createStatusBarButton(
      "$(export) SVG to Sandsara",
      "Convert an SVG into a continuous Sandsara .bin track",
      SVG_TO_TRACK_COMMAND,
      101
    ),
    createStatusBarButton(
      "$(preview) Open Sandsara Track",
      "Open a track from the workspace tracks folder",
      OPEN_TRACK_COMMAND,
      100
    )
  );
}

export function deactivate(): void {
  // VS Code disposes all registered resources through the extension context.
}

async function vectoriseImage(
  context: vscode.ExtensionContext,
  resource?: vscode.Uri
): Promise<void> {
  const imageUri = await resolveInputFile(
    resource,
    ["png", "jpg", "jpeg", "bmp", "webp", "gif"],
    "Select an image to vectorise",
    { Images: ["png", "jpg", "jpeg", "bmp", "webp", "gif"] }
  );

  if (imageUri === undefined) {
    return;
  }

  try {
    const bytes = await vscode.workspace.fs.readFile(imageUri);
    const mimeType = imageMimeType(imageUri);
    const dataUri = `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
    const panel = vscode.window.createWebviewPanel(
      "sandsara.imageVectoriser",
      `Vectorise: ${displayName(imageUri)}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    configureWebview(panel.webview, context.extensionUri);
    panel.webview.html = createWebviewHtml(
      panel.webview,
      context.extensionUri,
      "Sandsara Image Vectoriser",
      "imageVectoriser.js"
    );

    panel.webview.onDidReceiveMessage(async (message: unknown) => {
      if (isMessageType(message, "ready")) {
        const outgoing: ImageVectoriserHostMessage = {
          type: "initialiseImage",
          dataUri,
          filename: displayName(imageUri)
        };
        await panel.webview.postMessage(outgoing);
        return;
      }

      if (isMessageType(message, "showError") && typeof message.message === "string") {
        void vscode.window.showErrorMessage(message.message);
        return;
      }

      if (
        isMessageType(message, "saveSvg") &&
        typeof message.svg === "string" &&
        typeof message.suggestedName === "string"
      ) {
        const saveUri = await vscode.window.showSaveDialog({
          defaultUri: siblingUri(
            imageUri,
            safeFilename(message.suggestedName, "vectorised.svg")
          ),
          filters: { "Scalable Vector Graphics": ["svg"] },
          saveLabel: "Save vectorised SVG"
        });

        if (saveUri === undefined) {
          return;
        }

        await vscode.workspace.fs.writeFile(
          saveUri,
          new TextEncoder().encode(message.svg)
        );
        void vscode.window.showInformationMessage(
          `Saved vectorised artwork as ${displayName(saveUri)}.`
        );
      }
    });
  } catch (error: unknown) {
    void vscode.window.showErrorMessage(
      `Could not vectorise the image: ${toErrorMessage(error)}`
    );
  }
}

async function convertSvgToTrack(
  context: vscode.ExtensionContext,
  resource?: vscode.Uri
): Promise<void> {
  const svgUri = await resolveInputFile(
    resource,
    ["svg"],
    "Select an SVG to convert",
    { "Scalable Vector Graphics": ["svg"] }
  );

  if (svgUri === undefined) {
    return;
  }

  try {
    const bytes = await vscode.workspace.fs.readFile(svgUri);
    const svg = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const panel = vscode.window.createWebviewPanel(
      "sandsara.svgToTrack",
      `SVG to Track: ${displayName(svgUri)}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    configureWebview(panel.webview, context.extensionUri);
    panel.webview.html = createWebviewHtml(
      panel.webview,
      context.extensionUri,
      "SVG to Sandsara Track",
      "svgToTrack.js"
    );

    panel.webview.onDidReceiveMessage(async (message: unknown) => {
      if (isMessageType(message, "ready")) {
        const outgoing: SvgToTrackHostMessage = {
          type: "initialiseSvg",
          svg,
          filename: displayName(svgUri)
        };
        await panel.webview.postMessage(outgoing);
        return;
      }

      if (isMessageType(message, "showError") && typeof message.message === "string") {
        void vscode.window.showErrorMessage(message.message);
        return;
      }

      if (
        isMessageType(message, "saveTrack") &&
        Array.isArray(message.points) &&
        message.points.every(value => typeof value === "number") &&
        typeof message.suggestedName === "string"
      ) {
        await saveGeneratedTrack(svgUri, message.points, message.suggestedName);
      }
    });
  } catch (error: unknown) {
    void vscode.window.showErrorMessage(
      `Could not read the SVG: ${toErrorMessage(error)}`
    );
  }
}

async function saveGeneratedTrack(
  sourceUri: vscode.Uri,
  values: readonly number[],
  suggestedName: string
): Promise<void> {
  try {
    const points = pointsFromFlatArray(values);
    const encoded = encodeSandsaraTrack(points);
    const filename = safeFilename(
      suggestedName,
      "Sandsara-trackNumber-custom.bin"
    );
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: await defaultTrackUri(sourceUri, filename),
      filters: { "Sandsara Track": ["bin"] },
      saveLabel: "Save Sandsara track"
    });

    if (saveUri === undefined) {
      return;
    }

    await vscode.workspace.fs.writeFile(saveUri, encoded);
    void vscode.window.showInformationMessage(
      `Saved ${points.length.toLocaleString("en-GB")} points to ${displayName(saveUri)}.`
    );

    await vscode.commands.executeCommand(
      "vscode.openWith",
      saveUri,
      TRACK_VIEW_TYPE
    );
  } catch (error: unknown) {
    void vscode.window.showErrorMessage(
      `Could not generate the Sandsara track: ${toErrorMessage(error)}`
    );
  }
}

async function openTrack(resource?: vscode.Uri): Promise<void> {
  let trackUri: vscode.Uri | undefined;

  if (resource !== undefined && path.posix.extname(resource.path).toLowerCase() === ".bin") {
    trackUri = resource;
  } else {
    const defaultUri = await tracksDirectoryUri(true);
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      defaultUri,
      title: "Open a Sandsara track",
      filters: { "Sandsara Track": ["bin"] }
    });
    trackUri = selected?.[0];
  }

  if (trackUri === undefined) {
    return;
  }

  await vscode.commands.executeCommand(
    "vscode.openWith",
    trackUri,
    TRACK_VIEW_TYPE
  );
}

async function defaultTrackUri(
  sourceUri: vscode.Uri,
  filename: string
): Promise<vscode.Uri> {
  const directory = await tracksDirectoryUri(true);
  return directory === undefined
    ? siblingUri(sourceUri, filename)
    : vscode.Uri.joinPath(directory, filename);
}

async function tracksDirectoryUri(create: boolean): Promise<vscode.Uri | undefined> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (workspaceRoot === undefined) {
    return undefined;
  }

  const directory = vscode.Uri.joinPath(workspaceRoot, TRACKS_DIRECTORY_NAME);
  if (create) {
    await vscode.workspace.fs.createDirectory(directory);
  }
  return directory;
}

function createPreviewPayload(
  uri: vscode.Uri,
  track: ReturnType<typeof decodeSandsaraTrack>
): FlatTrackPayload {
  const maximumPreviewPoints = 100_000;
  const stride = Math.max(1, Math.ceil(track.points.length / maximumPreviewPoints));
  const flatPoints: number[] = [];

  for (let index = 0; index < track.points.length; index += stride) {
    const point = track.points[index];
    if (point !== undefined) {
      flatPoints.push(point.x, point.y);
    }
  }

  const finalPoint = track.points.at(-1);
  if (
    finalPoint !== undefined &&
    (flatPoints.at(-2) !== finalPoint.x || flatPoints.at(-1) !== finalPoint.y)
  ) {
    flatPoints.push(finalPoint.x, finalPoint.y);
  }

  return {
    points: flatPoints,
    pointCount: track.points.length,
    byteLength: track.byteLength,
    minX: track.minX,
    maxX: track.maxX,
    minY: track.minY,
    maxY: track.maxY,
    maximumRadius: track.maximumRadius,
    warnings: track.warnings,
    filename: displayName(uri)
  };
}

function createStatusBarButton(
  text: string,
  tooltip: string,
  command: string,
  priority: number
): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    priority
  );
  item.text = text;
  item.tooltip = tooltip;
  item.command = command;
  item.show();
  return item;
}

function configureWebview(webview: vscode.Webview, extensionUri: vscode.Uri): void {
  webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")]
  };
}

function createWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  title: string,
  scriptFilename: string
): string {
  const nonce = randomBytes(16).toString("hex");
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webviews", scriptFilename)
  );

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'wasm-unsafe-eval' ${webview.cspSource}; worker-src ${webview.cspSource}; connect-src ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
</head>
<body>
  <div id="app" aria-live="polite"></div>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function createErrorHtml(message: string): string {
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invalid Sandsara Track</title>
  <style>
    body { padding: 1rem; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
    pre { white-space: pre-wrap; }
  </style>
</head>
<body>
  <h1>Could not decode Sandsara track</h1>
  <pre>${escapeHtml(message)}</pre>
</body>
</html>`;
}

async function resolveInputFile(
  supplied: vscode.Uri | undefined,
  acceptedExtensions: readonly string[],
  title: string,
  filters: Record<string, string[]>
): Promise<vscode.Uri | undefined> {
  if (supplied !== undefined) {
    const extension = path.posix.extname(supplied.path).slice(1).toLowerCase();
    if (acceptedExtensions.includes(extension)) {
      return supplied;
    }
  }

  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    title,
    filters
  });

  return selected?.[0];
}

function imageMimeType(uri: vscode.Uri): string {
  switch (path.posix.extname(uri.path).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".bmp":
      return "image/bmp";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

function siblingUri(source: vscode.Uri, filename: string): vscode.Uri {
  return source.with({
    path: path.posix.join(path.posix.dirname(source.path), filename)
  });
}

function displayName(uri: vscode.Uri): string {
  return path.posix.basename(uri.path);
}

function safeFilename(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return fallback;
  }

  return trimmed.replace(/[\\/:*?"<>|\u0000-\u001F]/g, "-");
}

function isMessageType(
  value: unknown,
  type: string
): value is Record<string, unknown> & { readonly type: string } {
  return typeof value === "object" && value !== null &&
    "type" in value && value.type === type;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
