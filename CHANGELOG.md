# Change Log

## 0.3.5 - 2026-07-27

- makes outer-ring mode draw from the perimeter towards the centre
- starts at an exact point on the outer ring
- reverses the completed radial route instead of merely preferring an outer entry
- returns to the same outer-ring point over the graph of already travelled lines
- avoids a final direct cut across the finished drawing
- applies identical behaviour to the WebAssembly router and TypeScript fallback
- supports Visual Studio Code 1.87 and newer

## 0.3.4 - 2026-07-26

- replaces percentage-based circular padding with decimal Overscan from -1.00 to +1.00
- keeps -0.04 as the equivalent of the former 4% padding default
- enlarges artwork for positive Overscan and shrinks it for negative Overscan
- clips overscanned line segments exactly at the circular drawing boundary before routing
- splits strokes into valid in-circle paths when they leave and re-enter the canvas
- reuses sampled SVG geometry when Overscan changes

## 0.3.3 - 2026-07-26

- reuses sampled geometry, fitted geometry and completed routes across compatible slider changes
- changes Sandsara point spacing without recalculating the route
- cancels superseded worker jobs instead of leaving them running invisibly
- stores completed radial-path checkpoints in IndexedDB
- restores the travelled graph and resumes from the next unfinished path after interruption

## 0.3.2 - 2026-07-26

- streams completed radial paths from the WebAssembly worker while routing continues
- draws the calculated route live in both the website and Visual Studio Code
- adds a real path-count progress bar with an elapsed-time ETA estimate
- leaves outer-ring start and finish routing available but disabled by default

## 0.3.1 - 2026-07-26

- replaces repeated global path selection with a fixed inner-to-outer radial sweep
- reuses previously travelled geometry when moving to the next required component
- limits shortest-path graph searches to actual retracing before disconnected bridges
- preserves untouched-contour avoidance and outer-perimeter fallback routing
- keeps the router inside Baguette's restricted TypeScript subset for the shared WebAssembly build

## 0.3.0 - 2026-07-26

- replaces nearest-endpoint-only joining with geometry-aware routing over completed paths
- adds a persistent graph containing every travelled path and connector
- prioritises avoiding untouched SVG contours before connector distance
- adds perimeter preference and centre-travel penalties for less visible movement
- adds inner-to-outer ordering for nested and radial artwork
- adds named preview exports and strict four-digit Sandsara track filenames
- compiles the numerical route planner to WebAssembly with the pinned Baguette submodule
- moves route calculation into a shared Web Worker used by the website and Visual Studio Code
- keeps the TypeScript router as a reported emergency fallback and reference implementation
- adds direct image-to-track generation and browser progress feedback
- fixes native image selection on affected mobile and WebKit browsers
- removes temporary validation workflows and generated source files

## 0.2.0

- adds a fully client-side static website for GitHub Pages
- adds browser uploads for raster images, SVG artwork and Sandsara `.bin` tracks
- adds direct SVG and `.bin` downloads without an application server
- adds a continuous browser workflow from image vectorisation to track generation
- adds a calm, responsive Sandsara-inspired interface for desktop and mobile
- reuses the Visual Studio Code webview algorithms in the browser build
- adds an ignored workspace `tracks/` directory as the default Visual Studio Code track store
- adds **Open Sandsara Track** with track-folder-aware file selection
- enforces TypeScript-only authored executable source and removes generated JavaScript from `src/`

## 0.1.0

- adds raster-image to SVG vectorisation with Sobel, Otsu, marching-squares and line-simplification controls
- adds SVG to continuous Sandsara `.bin` track generation
- adds a Sandsara activity-bar view, status-bar buttons and Explorer context-menu commands
- moves all authored executable source and build tooling to TypeScript and `.mts` files
- changes the local runtime bundle to ignored `dist/` output

## 0.0.1

- adds read-only Sandsara binary track decoding and preview
