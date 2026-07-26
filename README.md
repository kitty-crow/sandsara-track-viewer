# Sandsara Track Viewer

Version **0.3.0** is a Visual Studio Code extension and fully client-side web studio for decoding, previewing and generating binary tracks used by Sandsara kinetic sand tables.

> **Independent project and trademark notice**
>
> Sandsara is a trademark and brand of Matter Collection, LLC. This project is independently developed and maintained by Kitty Crow. It is not owned, operated, authorised, endorsed or sponsored by Matter Collection, LLC or Sandsara. The Sandsara name is used only to identify product compatibility. No ownership of the Sandsara trademark, products, firmware, product designs or official assets is claimed.
>
> Official product information is available from [Sandsara](https://www.sandsara.io/) and the [official Sandsara store](https://www.sandsara.io/store).

## Features

- Opens and validates native Sandsara `.bin` tracks
- Previews tracks in Visual Studio Code or a web browser
- Converts PNG, JPEG, BMP, WebP and GIF images into line-based SVG artwork
- Passes vectorised artwork directly into track generation without an intermediate download
- Converts SVG geometry into a continuous, resampled Sandsara track
- Routes disconnected artwork over previously drawn geometry whenever possible
- Avoids crossing untouched contours before considering connector distance
- Orders nested and radial artwork from the centre towards the perimeter
- Exports named previews and strictly numbered `Sandsara-trackNumber-####.bin` files
- Compiles the route planner to WebAssembly for both Visual Studio Code and the website
- Keeps image, SVG and track processing local to the user's machine

## Browser studio

The static site provides three client-side tools:

1. **Image to SVG** extracts line art from a raster image and previews the vector result.
2. **SVG to `.bin`** calculates a continuous route, previews it and downloads the encoded track.
3. **View `.bin`** validates and visualises an existing Sandsara track.

After vectorisation, **Pass to `.bin`** transfers the generated SVG directly to the track builder within the same browser session. No application server is involved, and uploaded files are not transmitted by the studio.

The browser generator remains marked experimental while real-device behaviour and performance are evaluated across more detailed drawings. Route calculation now runs away from the interface thread in a Web Worker, so the same computational work no longer blocks the page or the Visual Studio Code webview.

## Visual Studio Code workflow

### Vectorise an image

Choose **Sandsara: Vectorise Image to SVG** from the Command Palette, activity-bar tools, status bar or an image file's Explorer context menu.

The vectoriser provides:

- greyscale conversion and contrast enhancement
- box-blur noise reduction
- Sobel edge detection with non-maximum suppression
- Otsu automatic thresholding
- marching-squares contour extraction
- Ramer-Douglas-Peucker simplification
- minimum line-length filtering

### Convert SVG to a track

Choose **Sandsara: Convert SVG to Sandsara Track (.bin)**. When a workspace is open, generated files default to the ignored `tracks/` directory and open immediately in the built-in preview.

### Open an existing track

Choose **Sandsara: Open Sandsara Track**. The picker starts in `tracks/`, creating it when necessary. Compatible files are associated with the Sandsara custom editor.

## Track calculation

A Sandsara ball cannot lift off the sand, so every disconnected SVG component must become part of one continuous walk. Version 0.3.1 uses a radial hierarchical postman heuristic instead of repeatedly re-optimising every remaining path after each stroke.

The calculation pipeline:

1. samples SVG geometry and scales it into the circular table space
2. calculates each required path's radial band and polar angle once
3. fixes an inner-to-outer radial sweep before tracing begins
4. rotates closed contours to a useful entry point
5. completes the next required path in that fixed sequence
6. continues directly when it already touches travelled geometry
7. when a disconnected component requires a bridge, finds the closest safe launch point anywhere on the travelled graph
8. runs one shortest-path search only to retrace from the ball's current position to that launch point
9. makes one shortest safe bridge, using the perimeter when it reduces crossings or visible travel
10. adds the bridge and completed component to the travelled graph
11. resamples the finished walk at approximately constant spacing
12. encodes the coordinates as native Sandsara six-byte records

This follows the practical structure of a hierarchical rural-postman route: required drawing edges are serviced in radial order, while previously serviced edges are available for retracing. It does not reconsider every untraced component at every step, so detailed drawings avoid the combinatorial slowdown of the previous global greedy search.

## Shared WebAssembly router

The numerical route planner lives in `src/router-wasm/router.ts` and is compiled by the pinned [`baguette`](https://github.com/kitty-crow/baguette) submodule.

`npm run build` performs the complete integration:

1. initialises the pinned Baguette submodule when it is absent
2. compiles the restricted TypeScript router through AssemblyScript and Binaryen
3. writes `build/router-wasm/path-router.wasm`
4. builds the Visual Studio Code and browser TypeScript runtimes
5. copies the same WebAssembly module and module worker into `dist/webviews/` and `dist/site/assets/webview/`

Both deployments therefore execute the same route planner through a Web Worker. The router advances one radial path at a time and streams each completed coordinate chunk back to the interface, so the preview grows live while a real path-count progress bar and elapsed-time ETA update in both the website and Visual Studio Code. Completed path chunks are checkpointed in IndexedDB and can rebuild the travelled graph after an interruption, allowing calculation to continue from the next unfinished radial path. SVG sampling, circular fitting and completed route results are cached independently, so changing only Sandsara point spacing reuses the route instead of calculating it again. The original TypeScript implementation remains as an emergency fallback and reference implementation; a fallback is reported to the console rather than occurring silently.

The compiler source is a build dependency only. It is excluded from the packaged VSIX, which contains the generated worker and WebAssembly module.

## Sandsara binary format

Each point occupies six bytes:

| Offset | Size | Description |
|---:|---:|---|
| 0 | 2 bytes | Signed 16-bit X coordinate, little-endian |
| 2 | 1 byte | Comma separator, `0x2C` |
| 3 | 2 bytes | Signed 16-bit Y coordinate, little-endian |
| 5 | 1 byte | Newline separator, `0x0A` |

The file has no header, footer, embedded title or thumbnail. Its total size must be divisible by six.

## Source layout

```text
src/extension.ts       Visual Studio Code extension host
src/webview/           shared browser tools and worker client
src/router-wasm/       Baguette-compatible numerical route planner
src/site/              static-site adapters
scripts/               TypeScript build, check, clean and packaging tools
web/                   authored HTML and CSS
baguette/               pinned compiler submodule
tracks/                local track storage, ignored by Git
build/                 generated compiler output, ignored by Git
dist/                  generated extension and site output, ignored by Git
```

All authored executable source is TypeScript or `.mts`. Generated JavaScript and WebAssembly are written only to ignored output directories.

## Development

Node.js 22.6 or newer is required.

```bash
git submodule update --init --recursive
npm ci
npm run compile
```

The normal build also initialises the submodule automatically, but the explicit command is useful after cloning or changing the pinned compiler revision.

Press `F5` in Visual Studio Code to launch an Extension Development Host. The generated static site is available in `dist/site/`.

For continuous TypeScript builds:

```bash
npm run watch
```

To build the installable extension:

```bash
npm run package-extension
```

## GitHub Pages

`.github/workflows/pages.yml` builds `dist/site/` from `main` and publishes it with GitHub's official Pages actions. Set **Settings → Pages → Source** to **GitHub Actions**.

## Author

Kitty Crow  
https://kittycrow.dev

## Licence

MIT
