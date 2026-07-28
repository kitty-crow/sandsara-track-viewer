import { randomBytes } from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";
import type {
  ImageVectoriserHostMessage,
  SvgToTrackHostMessage
} from "./messages";
import {
  encodeTrack,
  ptsFromFlat
} from "./sandsara";
import { EditableTrackEditor } from "./trackEditorProvider";

const TRACK_VIEW_TYPE = "sandsara.trackPreview";
const TOOLS_VIEW_ID = "sandsara.tools";
const VECTORISE_COMMAND = "sandsara.vectoriseImage";
const SVG_TO_TRACK_COMMAND = "sandsara.svgToTrack";
const OPEN_TRACK_COMMAND = "sandsara.openTrack";
const TRACKS_DIRECTORY_NAME = "tracks";

class ToolTree implements vscode.TreeDataProvider<never> {
  public getTreeItem(element: never): vscode.TreeItem {
    return element;
  }

  public getChildren(): never[] {
    return [];
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const editorProvider = new EditableTrackEditor(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      TRACK_VIEW_TYPE,
      editorProvider,
      { supportsMultipleEditorsPerDocument: true }
    ),
    vscode.window.registerTreeDataProvider(
      TOOLS_VIEW_ID,
      new ToolTree()
    ),
    vscode.commands.registerCommand(
      VECTORISE_COMMAND,
      async (resource?: vscode.Uri) => vectorise(context, resource)
    ),
    vscode.commands.registerCommand(
      SVG_TO_TRACK_COMMAND,
      async (resource?: vscode.Uri) => svgToTrack(context, resource)
    ),
    vscode.commands.registerCommand(
      OPEN_TRACK_COMMAND,
      async (resource?: vscode.Uri) => openTrack(resource)
    ),
    statusBtn(
      "$(symbol-color) Vectorise Image",
      "Vectorise a raster image into line-based SVG artwork",
      VECTORISE_COMMAND,
      102
    ),
    statusBtn(
      "$(export) SVG to Sandsara",
      "Convert an SVG into a continuous Sandsara .bin track",
      SVG_TO_TRACK_COMMAND,
      101
    ),
    statusBtn(
      "$(preview) Open Sandsara Track",
      "Open and edit a track from the workspace tracks folder",
      OPEN_TRACK_COMMAND,
      100
    )
  );
}

export function deactivate(): void {
  // VS Code disposes all registered resources through the extension context.
}

async function vectorise(
  context: vscode.ExtensionContext,
  resource?: vscode.Uri
): Promise<void> {
  const imageUri = await pickFile(
    resource,
    ["png", "jpg", "jpeg", "bmp", "webp", "gif"],
    "Select an image to vectorise",
    { Images: ["png", "jpg", "jpeg", "bmp", "webp", "gif"] }
  );

  if (imageUri === undefined) return;

  try {
    const bytes = await vscode.workspace.fs.readFile(imageUri);
    const mimeType = imgMime(imageUri);
    const dataUri = `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
    const panel = vscode.window.createWebviewPanel(
      "sandsara.imageVectoriser",
      `Vectorise: ${nameOf(imageUri)}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    setWebview(panel.webview, context.extensionUri);
    panel.webview.html = webviewHtml(
      panel.webview,
      context.extensionUri,
      "Sandsara Image Vectoriser",
      "imageVectoriser.js"
    );

    panel.webview.onDidReceiveMessage(async (message: unknown) => {
      if (isMsg(message, "ready")) {
        const outgoing: ImageVectoriserHostMessage = {
          type: "initialiseImage",
          dataUri,
          filename: nameOf(imageUri)
        };
        await panel.webview.postMessage(outgoing);
        return;
      }

      if (isMsg(message, "showError") && typeof message.message === "string") {
        void vscode.window.showErrorMessage(message.message);
        return;
      }

      if (
        isMsg(message, "saveSvg") &&
        typeof message.svg === "string" &&
        typeof message.suggestedName === "string"
      ) {
        const saveUri = await vscode.window.showSaveDialog({
          defaultUri: sibling(
            imageUri,
            safeName(message.suggestedName, "vectorised.svg")
          ),
          filters: { "Scalable Vector Graphics": ["svg"] },
          saveLabel: "Save vectorised SVG"
        });

        if (saveUri === undefined) return;

        await vscode.workspace.fs.writeFile(
          saveUri,
          new TextEncoder().encode(message.svg)
        );
        void vscode.window.showInformationMessage(
          `Saved vectorised artwork as ${nameOf(saveUri)}.`
        );
      }
    });
  } catch (error: unknown) {
    void vscode.window.showErrorMessage(
      `Could not vectorise the image: ${errMsg(error)}`
    );
  }
}

async function svgToTrack(
  context: vscode.ExtensionContext,
  resource?: vscode.Uri
): Promise<void> {
  const svgUri = await pickFile(
    resource,
    ["svg"],
    "Select an SVG to convert",
    { "Scalable Vector Graphics": ["svg"] }
  );

  if (svgUri === undefined) return;

  try {
    const bytes = await vscode.workspace.fs.readFile(svgUri);
    const svg = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const panel = vscode.window.createWebviewPanel(
      "sandsara.svgToTrack",
      `SVG to Track: ${nameOf(svgUri)}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    setWebview(panel.webview, context.extensionUri);
    panel.webview.html = webviewHtml(
      panel.webview,
      context.extensionUri,
      "SVG to Sandsara Track",
      "svgToTrack.js"
    );

    panel.webview.onDidReceiveMessage(async (message: unknown) => {
      if (isMsg(message, "ready")) {
        const outgoing: SvgToTrackHostMessage = {
          type: "initialiseSvg",
          svg,
          filename: nameOf(svgUri)
        };
        await panel.webview.postMessage(outgoing);
        return;
      }

      if (isMsg(message, "showError") && typeof message.message === "string") {
        void vscode.window.showErrorMessage(message.message);
        return;
      }

      if (
        isMsg(message, "saveTrack") &&
        Array.isArray(message.points) &&
        message.points.every(value => typeof value === "number") &&
        typeof message.suggestedName === "string"
      ) {
        await saveTrack(svgUri, message.points, message.suggestedName);
      }
    });
  } catch (error: unknown) {
    void vscode.window.showErrorMessage(
      `Could not read the SVG: ${errMsg(error)}`
    );
  }
}

async function saveTrack(
  sourceUri: vscode.Uri,
  values: readonly number[],
  suggestedName: string
): Promise<void> {
  try {
    const points = ptsFromFlat(values);
    const encoded = encodeTrack(points);
    const filename = safeName(
      suggestedName,
      "Sandsara-trackNumber-custom.bin"
    );
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: await defaultTrack(sourceUri, filename),
      filters: { "Sandsara Track": ["bin"] },
      saveLabel: "Save Sandsara track"
    });

    if (saveUri === undefined) return;

    await vscode.workspace.fs.writeFile(saveUri, encoded);
    void vscode.window.showInformationMessage(
      `Saved ${points.length.toLocaleString("en-GB")} points to ${nameOf(saveUri)}.`
    );

    await vscode.commands.executeCommand(
      "vscode.openWith",
      saveUri,
      TRACK_VIEW_TYPE
    );
  } catch (error: unknown) {
    void vscode.window.showErrorMessage(
      `Could not generate the Sandsara track: ${errMsg(error)}`
    );
  }
}

async function openTrack(resource?: vscode.Uri): Promise<void> {
  let trackUri: vscode.Uri | undefined;

  if (resource !== undefined && path.posix.extname(resource.path).toLowerCase() === ".bin") {
    trackUri = resource;
  } else {
    const defaultUri = await trackDir(true);
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

  if (trackUri === undefined) return;

  await vscode.commands.executeCommand(
    "vscode.openWith",
    trackUri,
    TRACK_VIEW_TYPE
  );
}

async function defaultTrack(
  sourceUri: vscode.Uri,
  filename: string
): Promise<vscode.Uri> {
  const directory = await trackDir(true);
  return directory === undefined
    ? sibling(sourceUri, filename)
    : vscode.Uri.joinPath(directory, filename);
}

async function trackDir(create: boolean): Promise<vscode.Uri | undefined> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (workspaceRoot === undefined) return undefined;

  const directory = vscode.Uri.joinPath(workspaceRoot, TRACKS_DIRECTORY_NAME);
  if (create) await vscode.workspace.fs.createDirectory(directory);
  return directory;
}

function statusBtn(
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

function setWebview(webview: vscode.Webview, extensionUri: vscode.Uri): void {
  webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")]
  };
}

function webviewHtml(
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'wasm-unsafe-eval' ${webview.cspSource}; worker-src blob:; connect-src ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
</head>
<body>
  <div id="app" aria-live="polite"></div>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

async function pickFile(
  supplied: vscode.Uri | undefined,
  acceptedExtensions: readonly string[],
  title: string,
  filters: Record<string, string[]>
): Promise<vscode.Uri | undefined> {
  if (supplied !== undefined) {
    const extension = path.posix.extname(supplied.path).slice(1).toLowerCase();
    if (acceptedExtensions.includes(extension)) return supplied;
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

function imgMime(uri: vscode.Uri): string {
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

function sibling(source: vscode.Uri, filename: string): vscode.Uri {
  return source.with({
    path: path.posix.join(path.posix.dirname(source.path), filename)
  });
}

function nameOf(uri: vscode.Uri): string {
  return path.posix.basename(uri.path);
}

function safeName(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return fallback;
  return trimmed.replace(/[\\/:*?"<>|\u0000-\u001F]/g, "-");
}

function isMsg(
  value: unknown,
  type: string
): value is Record<string, unknown> & { readonly type: string } {
  return typeof value === "object" && value !== null &&
    "type" in value && value.type === type;
}

function errMsg(error: unknown): string {
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
