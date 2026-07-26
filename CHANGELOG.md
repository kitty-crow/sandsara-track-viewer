# Change Log

## 0.2.0

- Added a fully client-side static website for GitHub Pages.
- Added browser uploads for raster images, SVG artwork and Sandsara `.bin` tracks.
- Added direct SVG and `.bin` downloads without an application server.
- Added a continuous browser workflow from image vectorisation to track generation.
- Added a calm, responsive Sandsara-inspired interface for desktop and mobile.
- Reused the VS Code webview algorithms in the browser build.
- Added an ignored workspace `tracks/` directory as the default VS Code track store.
- Added **Open Sandsara Track** in VS Code with track-folder-aware file selection.
- Added end-to-end browser validation that uploads an image, produces SVG, generates a `.bin` and visualises it again.
- Added CI packaging and validation of the VS Code VSIX.
- Added GitHub Actions build and conditional Pages deployment from the public `main` branch.
- Enforced TypeScript-only authored executable source and removed generated JavaScript from `src/`.
- Kept all generated JavaScript inside ignored `dist/` and CI artifacts.

## 0.1.0

- Added raster-image to SVG vectorisation with Sobel, Otsu, marching-squares and line-simplification controls.
- Added SVG to continuous Sandsara `.bin` track generation.
- Added a Sandsara activity-bar view, status-bar buttons and Explorer context-menu commands.
- Moved all authored executable source and build tooling to TypeScript and `.mts` files.
- Changed the local runtime bundle to ignored `dist/` output.

## 0.0.1

- Added read-only Sandsara binary track decoding and preview.
