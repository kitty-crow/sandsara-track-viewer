## 0.3.2 - 2026-07-26

- streams completed radial paths from the WebAssembly worker while routing continues
- draws the calculated route live in both the website and Visual Studio Code
- adds a real path-count progress bar with an elapsed-time ETA estimate
- leaves outer-edge start and finish routing available but disabled by default

# Change Log

## 0.3.1

- Replaced repeated global path selection with a fixed inner-to-outer radial sweep.
- Reused previously travelled geometry only when moving to the next required component.
- Limited shortest-path graph searches to actual retracing before disconnected bridges.
- Preserved untouched-contour avoidance and outer-perimeter fallback routing.
- Kept the router inside Baguette's restricted TypeScript subset for the shared WebAssembly build.

## 0.3.0

- Replaced nearest-endpoint-only joining with geometry-aware routing over completed paths.
- Added a persistent graph containing every travelled path and connector.
- Prioritised avoiding untouched SVG contours before connector distance.
- Added perimeter preference and centre-travel penalties for less visible movement.
- Added inner-to-outer ordering for nested and radial artwork.
- Added named preview exports and strict four-digit Sandsara track filenames.
- Compiled the numerical route planner to WebAssembly with the pinned Baguette submodule.
- Moved route calculation into a shared Web Worker used by the website and Visual Studio Code.
- Kept the TypeScript router as a reported emergency fallback and reference implementation.
- Added direct image-to-track generation and browser progress feedback.
- Fixed native image selection on affected mobile and WebKit browsers.
- Bumped the extension and web studio to version 0.3.0.
- Rewrote the repository history into fifteen logical milestones.
- Removed temporary validation workflows and the standalone router validation script.
- Expanded the README with the current route-calculation and WebAssembly architecture.

## 0.2.0

- Added a fully client-side static website for GitHub Pages.
- Added browser uploads for raster images, SVG artwork and Sandsara `.bin` tracks.
- Added direct SVG and `.bin` downloads without an application server.
- Added a continuous browser workflow from image vectorisation to track generation.
- Added a calm, responsive Sandsara-inspired interface for desktop and mobile.
- Reused the Visual Studio Code webview algorithms in the browser build.
- Added an ignored workspace `tracks/` directory as the default Visual Studio Code track store.
- Added **Open Sandsara Track** with track-folder-aware file selection.
- Enforced TypeScript-only authored executable source and removed generated JavaScript from `src/`.
- Kept generated JavaScript inside ignored `dist/` output.

## 0.1.0

- Added raster-image to SVG vectorisation with Sobel, Otsu, marching-squares and line-simplification controls.
- Added SVG to continuous Sandsara `.bin` track generation.
- Added a Sandsara activity-bar view, status-bar buttons and Explorer context-menu commands.
- Moved all authored executable source and build tooling to TypeScript and `.mts` files.
- Changed the local runtime bundle to ignored `dist/` output.

## 0.0.1

- Added read-only Sandsara binary track decoding and preview.
