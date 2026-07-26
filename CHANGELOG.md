# Change Log

## 0.2.0

- Added a fully client-side static website for GitHub Pages.
- Added browser uploads for raster images, SVG artwork and Sandsara `.bin` tracks.
- Added direct SVG and `.bin` downloads without an application server.
- Reused the VS Code webview algorithms in the browser build.
- Added GitHub Actions build and Pages deployment from TypeScript source.
- Kept all generated JavaScript inside ignored `dist/` and CI artifacts.

## 0.1.0

- Added raster-image to SVG vectorisation with Sobel, Otsu, marching-squares and line-simplification controls.
- Added SVG to continuous Sandsara `.bin` track generation.
- Added a Sandsara activity-bar view, status-bar buttons and Explorer context-menu commands.
- Moved all authored executable source and build tooling to TypeScript and `.mts` files.
- Changed the local runtime bundle to ignored `dist/` output.

## 0.0.1

- Added read-only Sandsara binary track decoding and preview.
