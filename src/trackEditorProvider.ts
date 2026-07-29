import { randomBytes } from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";
import type {
  FlatTrackPayload,
  TrackEditorState,
  TrackPreviewHostMessage,
  TrackPreviewWebviewMessage
} from "./messages";
import {
  decodeTrack,
  encodeTrack,
  ptsFromFlat,
  type SandsaraPoint
} from "./sandsara";

export class EditableTrackEditor implements vscode.CustomEditorProvider<TrackDoc> {
  private readonly changes = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<TrackDoc>>();
  public readonly onDidChangeCustomDocument = this.changes.event;

  public constructor(private readonly extensionUri: vscode.Uri) {}

  public async openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): Promise<TrackDoc> {
    const source = openContext.backupId === undefined ? uri : vscode.Uri.parse(openContext.backupId);
    const bytes = await vscode.workspace.fs.readFile(source);
    return new TrackDoc(uri, decodeTrack(bytes).points);
  }

  public async resolveCustomEditor(
    document: TrackDoc,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    configureWebview(panel.webview, this.extensionUri);
    panel.webview.html = editorHtml(panel.webview, this.extensionUri);
    document.addPanel(panel);

    panel.onDidDispose(() => document.removePanel(panel));
    panel.webview.onDidReceiveMessage(async (message: unknown) => {
      if (isMessage(message, "ready")) {
        await document.post(panel.webview, true);
        return;
      }
      if (isMessage(message, "showError") && typeof message.message === "string") {
        void vscode.window.showErrorMessage(message.message);
        return;
      }
      if (isMessage(message, "openTrack")) {
        await vscode.commands.executeCommand("sandsara.openTrack");
        return;
      }
      if (isMessage(message, "resetTrack")) {
        try {
          await vscode.commands.executeCommand("workbench.action.files.revert");
        } catch (error: unknown) {
          await postState(panel.webview, "invalid", `Could not restore the track: ${errorMessage(error)}`);
        }
        return;
      }
      if (isTrackEdit(message, "editTrack")) {
        await this.applyEdit(document, ptsFromFlat(message.points), true);
        return;
      }
      if (isTrackEdit(message, "saveTrack")) {
        try {
          await this.applyEdit(document, ptsFromFlat(message.points), false);
          await vscode.commands.executeCommand("workbench.action.files.save");
        } catch (error: unknown) {
          const text = `Could not save the track: ${errorMessage(error)}`;
          await postState(panel.webview, "dirty", `${text} Unsaved changes remain in memory.`);
          void vscode.window.showErrorMessage(text);
        }
      }
    });
  }

  public async saveCustomDocument(
    document: TrackDoc,
    _cancellation: vscode.CancellationToken
  ): Promise<void> {
    await vscode.workspace.fs.writeFile(document.uri, document.bytes());
    await document.broadcast(true);
  }

  public async saveCustomDocumentAs(
    document: TrackDoc,
    destination: vscode.Uri,
    _cancellation: vscode.CancellationToken
  ): Promise<void> {
    await vscode.workspace.fs.writeFile(destination, document.bytes());
    await document.broadcast(true);
  }

  public async revertCustomDocument(
    document: TrackDoc,
    _cancellation: vscode.CancellationToken
  ): Promise<void> {
    const bytes = await vscode.workspace.fs.readFile(document.uri);
    document.replace(decodeTrack(bytes).points);
    await document.broadcast(true);
  }

  public async backupCustomDocument(
    document: TrackDoc,
    context: vscode.CustomDocumentBackupContext,
    _cancellation: vscode.CancellationToken
  ): Promise<vscode.CustomDocumentBackup> {
    await vscode.workspace.fs.writeFile(context.destination, document.bytes());
    return {
      id: context.destination.toString(),
      delete: async () => {
        try {
          await vscode.workspace.fs.delete(context.destination);
        } catch {
          // The backup may already have been removed by VS Code.
        }
      }
    };
  }

  private async applyEdit(
    document: TrackDoc,
    points: readonly SandsaraPoint[],
    sync: boolean
  ): Promise<void> {
    if (samePoints(document.points(), points)) return;

    const before = clonePoints(document.points());
    const after = clonePoints(points);
    document.replace(after);
    if (sync) await document.broadcast(false);

    this.changes.fire({
      document,
      label: `Edit ${after.length.toLocaleString("en-GB")} track points`,
      undo: async () => {
        document.replace(before);
        await document.broadcast(false);
      },
      redo: async () => {
        document.replace(after);
        await document.broadcast(false);
      }
    });
  }
}

class TrackDoc implements vscode.CustomDocument {
  private current: SandsaraPoint[];
  private readonly panels = new Set<vscode.WebviewPanel>();

  public constructor(public readonly uri: vscode.Uri, points: readonly SandsaraPoint[]) {
    this.current = clonePoints(points);
  }

  public dispose(): void {
    this.panels.clear();
  }

  public points(): readonly SandsaraPoint[] {
    return this.current;
  }

  public replace(points: readonly SandsaraPoint[]): void {
    this.current = clonePoints(points);
  }

  public bytes(): Uint8Array {
    return encodeTrack(this.current);
  }

  public addPanel(panel: vscode.WebviewPanel): void {
    this.panels.add(panel);
  }

  public removePanel(panel: vscode.WebviewPanel): void {
    this.panels.delete(panel);
  }

  public async post(webview: vscode.Webview, resetOriginal: boolean): Promise<void> {
    const outgoing: TrackPreviewHostMessage = {
      type: "track",
      payload: payload(this.uri, this.current),
      resetOriginal
    };
    await webview.postMessage(outgoing);
  }

  public async broadcast(resetOriginal: boolean): Promise<void> {
    await Promise.all([...this.panels].map(panel => this.post(panel.webview, resetOriginal)));
  }
}

async function postState(
  webview: vscode.Webview,
  state: TrackEditorState,
  message: string
): Promise<void> {
  const outgoing: TrackPreviewHostMessage = { type: "state", state, message };
  await webview.postMessage(outgoing);
}

function payload(uri: vscode.Uri, points: readonly SandsaraPoint[]): FlatTrackPayload {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maximumRadius = 0;
  let outside = 0;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
    const radius = Math.hypot(point.x, point.y);
    maximumRadius = Math.max(maximumRadius, radius);
    if (radius > 32_768) outside++;
  }

  const warnings = outside === 0
    ? []
    : [`${outside} points lie outside the nominal 32767-unit drawing radius.`];
  return {
    points: points.flatMap(point => [point.x, point.y]),
    pointCount: points.length,
    byteLength: points.length * 6,
    minX,
    maxX,
    minY,
    maxY,
    maximumRadius,
    warnings,
    filename: path.posix.basename(uri.path)
  };
}

function clonePoints(points: readonly SandsaraPoint[]): SandsaraPoint[] {
  return points.map(point => ({ x: point.x, y: point.y }));
}

function samePoints(left: readonly SandsaraPoint[], right: readonly SandsaraPoint[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    const a = left[index];
    const b = right[index];
    if (a === undefined || b === undefined || a.x !== b.x || a.y !== b.y) return false;
  }
  return true;
}

function isTrackEdit(
  message: unknown,
  type: "editTrack"
): message is Extract<TrackPreviewWebviewMessage, { readonly type: "editTrack" }>;
function isTrackEdit(
  message: unknown,
  type: "saveTrack"
): message is Extract<TrackPreviewWebviewMessage, { readonly type: "saveTrack" }>;
function isTrackEdit(message: unknown, type: string): message is {
  readonly type: string;
  readonly points: readonly number[];
  readonly source: string;
} {
  return isMessage(message, type) && Array.isArray(message.points) &&
    message.points.every(value => typeof value === "number") &&
    typeof message.source === "string";
}

function isMessage(
  value: unknown,
  type: string
): value is Record<string, unknown> & { readonly type: string } {
  return typeof value === "object" && value !== null && "type" in value && value.type === type;
}

function configureWebview(webview: vscode.Webview, extensionUri: vscode.Uri): void {
  webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")]
  };
}

function editorHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = randomBytes(16).toString("hex");
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webviews", "trackPreview.js")
  );
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sandsara Track Editor</title>
</head>
<body>
  <div id="app" aria-live="polite"></div>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
