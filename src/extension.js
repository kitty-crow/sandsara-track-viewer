"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const node_crypto_1 = require("node:crypto");
const sandsara_1 = require("./sandsara");
const VIEW_TYPE = "sandsara.trackPreview";
class SandsaraDocument {
    uri;
    constructor(uri) {
        this.uri = uri;
    }
    dispose() {
        // Nothing to release yet.
    }
}
class SandsaraEditorProvider {
    async openCustomDocument(uri, _openContext, _token) {
        return new SandsaraDocument(uri);
    }
    async resolveCustomEditor(document, panel, _token) {
        panel.webview.options = {
            enableScripts: true
        };
        try {
            /*
             * workspace.fs also works with remote workspaces, SSH and
             * other VS Code file-system providers.
             */
            const bytes = await vscode.workspace.fs.readFile(document.uri);
            const track = (0, sandsara_1.decodeSandsaraTrack)(bytes);
            panel.webview.html = createPreviewHtml(panel.webview, document.uri, track);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            panel.webview.html = createErrorHtml(message);
        }
    }
}
function activate(context) {
    const provider = new SandsaraEditorProvider();
    context.subscriptions.push(vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
        supportsMultipleEditorsPerDocument: true
    }));
}
function deactivate() {
    // No global resources to release.
}
function createPreviewHtml(webview, uri, track) {
    const nonce = (0, node_crypto_1.randomBytes)(16).toString("hex");
    /*
     * Decode and validate the complete file, but limit the amount transferred
     * into the webview for exceptionally large tracks.
     */
    const maximumPreviewPoints = 100_000;
    const stride = Math.max(1, Math.ceil(track.points.length / maximumPreviewPoints));
    const previewPoints = [];
    for (let index = 0; index < track.points.length; index += stride) {
        const point = track.points[index];
        previewPoints.push(point.x, point.y);
    }
    // Ensure the final point is represented.
    const finalPoint = track.points.at(-1);
    if (finalPoint !== undefined) {
        const length = previewPoints.length;
        if (previewPoints[length - 2] !== finalPoint.x ||
            previewPoints[length - 1] !== finalPoint.y) {
            previewPoints.push(finalPoint.x, finalPoint.y);
        }
    }
    const warningHtml = track.warnings.length === 0
        ? ""
        : `<section class="warnings">
                ${track.warnings
            .map(warning => `<p>${escapeHtml(warning)}</p>`)
            .join("")}
               </section>`;
    return `<!DOCTYPE html>
<html lang="en-GB">
<head>
    <meta charset="UTF-8">
    <meta
        http-equiv="Content-Security-Policy"
        content="
            default-src 'none';
            script-src 'nonce-${nonce}';
            style-src ${webview.cspSource} 'unsafe-inline';
        "
    >
    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    >

    <title>Sandsara Track Preview</title>

    <style>
        body {
            box-sizing: border-box;
            margin: 0;
            padding: 16px;
            color: var(--vscode-editor-foreground);
            background: var(--vscode-editor-background);
            font-family: var(--vscode-font-family);
        }

        h1 {
            margin: 0 0 4px;
            font-size: 1.3rem;
        }

        .filename {
            margin-bottom: 16px;
            color: var(--vscode-descriptionForeground);
        }

        .layout {
            display: grid;
            grid-template-columns: minmax(300px, 1fr) minmax(220px, 320px);
            gap: 18px;
        }

        canvas {
            display: block;
            width: 100%;
            aspect-ratio: 1;
            border: 1px solid var(--vscode-panel-border);
            background: var(--vscode-editor-background);
        }

        dl {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 8px 12px;
            margin: 0;
        }

        dt {
            color: var(--vscode-descriptionForeground);
        }

        dd {
            margin: 0;
            font-family: var(--vscode-editor-font-family);
        }

        .warnings {
            margin-top: 16px;
            padding: 8px 12px;
            color: var(--vscode-editorWarning-foreground);
            border: 1px solid var(--vscode-editorWarning-border);
        }

        @media (max-width: 750px) {
            .layout {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>

<body>
    <h1>Sandsara track</h1>
    <div class="filename">${escapeHtml(uri.path.split("/").at(-1) ?? uri.path)}</div>

    <div class="layout">
        <canvas id="preview"></canvas>

        <section>
            <dl>
                <dt>File size</dt>
                <dd>${track.byteLength.toLocaleString("en-GB")} bytes</dd>

                <dt>Points</dt>
                <dd>${track.points.length.toLocaleString("en-GB")}</dd>

                <dt>X range</dt>
                <dd>${track.minX} to ${track.maxX}</dd>

                <dt>Y range</dt>
                <dd>${track.minY} to ${track.maxY}</dd>

                <dt>Maximum radius</dt>
                <dd>${track.maximumRadius.toFixed(2)}</dd>

                <dt>Preview stride</dt>
                <dd>${stride}</dd>

                <dt>First point</dt>
                <dd>
                    ${track.points[0].x},
                    ${track.points[0].y}
                </dd>

                <dt>Final point</dt>
                <dd>
                    ${finalPoint?.x ?? "N/A"},
                    ${finalPoint?.y ?? "N/A"}
                </dd>
            </dl>

            ${warningHtml}
        </section>
    </div>

    <script nonce="${nonce}">
        const coordinates = ${JSON.stringify(previewPoints)};
        const canvas = document.getElementById("preview");
        const context = canvas.getContext("2d");

        function draw() {
            const ratio = window.devicePixelRatio || 1;
            const bounds = canvas.getBoundingClientRect();

            canvas.width = Math.max(1, Math.floor(bounds.width * ratio));
            canvas.height = Math.max(1, Math.floor(bounds.width * ratio));

            const width = canvas.width;
            const height = canvas.height;
            const padding = 18 * ratio;
            const radius = Math.min(width, height) / 2 - padding;
            const centreX = width / 2;
            const centreY = height / 2;
            const scale = radius / 32768;

            context.clearRect(0, 0, width, height);

            const styles = getComputedStyle(document.body);

            context.strokeStyle =
                styles.getPropertyValue("--vscode-panel-border");
            context.lineWidth = ratio;
            context.beginPath();
            context.arc(centreX, centreY, radius, 0, Math.PI * 2);
            context.stroke();

            if (coordinates.length < 2) {
                return;
            }

            context.strokeStyle =
                styles.getPropertyValue("--vscode-editor-foreground");
            context.lineWidth = Math.max(1, ratio * 0.7);
            context.lineJoin = "round";
            context.lineCap = "round";

            context.beginPath();

            for (let index = 0; index < coordinates.length; index += 2) {
                const x = centreX + coordinates[index] * scale;
                const y = centreY - coordinates[index + 1] * scale;

                if (index === 0) {
                    context.moveTo(x, y);
                } else {
                    context.lineTo(x, y);
                }
            }

            context.stroke();

            drawMarker(
                coordinates[0],
                coordinates[1],
                "--vscode-charts-green"
            );

            drawMarker(
                coordinates[coordinates.length - 2],
                coordinates[coordinates.length - 1],
                "--vscode-charts-red"
            );

            function drawMarker(rawX, rawY, colourVariable) {
                const x = centreX + rawX * scale;
                const y = centreY - rawY * scale;

                context.fillStyle =
                    styles.getPropertyValue(colourVariable);
                context.beginPath();
                context.arc(x, y, 4 * ratio, 0, Math.PI * 2);
                context.fill();
            }
        }

        new ResizeObserver(draw).observe(canvas);
        draw();
    </script>
</body>
</html>`;
}
function createErrorHtml(message) {
    return `<!DOCTYPE html>
<html lang="en-GB">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width">
    <title>Invalid Sandsara Track</title>
</head>
<body>
    <h1>Could not decode Sandsara track</h1>
    <pre>${escapeHtml(message)}</pre>
</body>
</html>`;
}
function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
//# sourceMappingURL=extension.js.map