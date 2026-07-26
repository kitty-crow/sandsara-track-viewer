# Sandsara Track Viewer

A Visual Studio Code extension and serverless web studio for decoding, validating, previewing and generating binary tracks used by Sandsara kinetic sand tables.

> **Independent project and trademark notice**
>
> Sandsara is a trademark and brand of Matter Collection, LLC. This project is independently developed and maintained by Kitty Crow. It is not owned, operated, authorised, endorsed, sponsored by or otherwise affiliated with Matter Collection, LLC or Sandsara. The Sandsara name is used only to identify product compatibility. No ownership of the Sandsara trademark, products, firmware, product designs or official assets is claimed.
>
> Official product information and tables are available from [Sandsara](https://www.sandsara.io/) and the [official Sandsara store](https://www.sandsara.io/store).

## Features

- Opens Sandsara `.bin` tracks as a visual path preview
- Validates the six-byte Cartesian coordinate record format
- Converts PNG, JPEG, BMP, WebP and GIF images into line-based SVG artwork
- Converts SVG geometry into a continuous, resampled Sandsara `.bin` track
- Downloads generated SVG and `.bin` files directly from the browser
- Opens generated VS Code tracks immediately in the built-in preview
- Uses an ignored workspace `tracks/` folder as the default local track store
- Keeps all authored executable source and build tooling in TypeScript or `.mts`
- Builds the VS Code runtime and static GitHub Pages site through workers

## Browser studio

The static site provides three fully client-side tools in a calm, responsive interface:

1. **Image to SVG** uploads raster artwork, applies contrast and line extraction, previews the result and downloads a vectorised SVG.
2. **SVG to `.bin`** uploads an SVG, calculates a continuous Sandsara route, previews the generated path and downloads the encoded binary track.
3. **View `.bin`** uploads an existing Sandsara track, validates every record and visualises the decoded path and statistics.

Saving a vectorised SVG also makes it available to the track generator for the current browser session, so the image-to-track workflow can continue without uploading the SVG again.

No application server is required. Images, SVG files and tracks remain inside the browser and are not transmitted anywhere.

The authored web source lives in `web/`, `src/site/` and `src/webview/`. GitHub Actions runs the TypeScript build and publishes only the generated `dist/site/` artifact. Generated JavaScript is never committed to the repository.

## VS Code workflow

### 1. Vectorise a raster image

Choose **Sandsara: Vectorise Image to SVG** from the Command Palette, the Sandsara activity-bar panel, the status bar, or an image file's Explorer context menu.

The editor provides controls for:

- contrast enhancement and greyscale conversion
- Sobel edge detection with non-maximum suppression
- Otsu automatic thresholding for black-and-white contours
- noise reduction
- marching-squares contour extraction
- Ramer-Douglas-Peucker line simplification
- minimum line-length filtering

Save the result as an SVG after the preview looks suitable.

### 2. Convert SVG to a Sandsara track

Choose **Sandsara: Convert SVG to Sandsara Track (.bin)**.

The converter:

1. samples standard SVG geometry using the browser's SVG geometry APIs
2. applies element transformations
3. scales the artwork into Sandsara's circular coordinate space
4. orders separate paths using nearest-endpoint routing
5. joins disconnected paths because the magnetic ball cannot lift
6. resamples the complete route at approximately constant spacing
7. encodes each coordinate as a native Sandsara six-byte record

When a workspace is open, the save dialog defaults to:

```text
tracks/Sandsara-trackNumber-<name>.bin
```

The `tracks/` directory is ignored by Git and is the standard local location for generated, imported and tested track files. The generated track opens immediately in the built-in preview after it is saved.

### 3. Open an existing track

Choose **Sandsara: Open Sandsara Track**. The file picker opens in the workspace `tracks/` folder, creating the folder when necessary. Files inside `tracks/` are automatically associated with the Sandsara custom preview.

## Important limitation

A Sandsara ball cannot lift off the sand. When an SVG contains disconnected lines, the converter must draw connector lines between them. The current implementation uses a nearest-endpoint heuristic to keep those connectors short, but they can remain visible in the final sand drawing.

## Sandsara binary format

Each point occupies six bytes:

| Offset | Size | Description |
|---:|---:|---|
| 0 | 2 bytes | Signed 16-bit X coordinate, little-endian |
| 2 | 1 byte | Comma separator, `0x2C` |
| 3 | 2 bytes | Signed 16-bit Y coordinate, little-endian |
| 5 | 1 byte | Newline separator, `0x0A` |

The file contains no header or footer. Its total size must be divisible by six.

## TypeScript-only source layout

All authored executable source is TypeScript:

```text
src/extension.ts       VS Code extension host
src/webview/           shared browser-based tools
src/site/              static-site adapters
scripts/               local .mts build and packaging tools
web/                   authored HTML and CSS
.github/workflows/     CI and GitHub Pages deployment
tracks/                local track storage, ignored by Git
build/                 local and CI validation output, ignored by Git
dist/                  generated JavaScript and site output, ignored by Git
```

VS Code loads `dist/extension.js` locally and from the packaged VSIX. GitHub Pages publishes `dist/site/`. Both are generated by CI or the local build and are not committed.

The validation script fails if an authored `.js`, `.mjs` or `.cjs` file is found outside ignored build directories.

## Development

Node.js 22.6 or newer is required for native `.mts` type stripping in the root build scripts.

```bash
npm install
npm run compile
```

Press `F5` in Visual Studio Code to launch an Extension Development Host.

The generated static site is available locally at `dist/site/`. Serve that directory with any static-file server for browser testing.

For continuous TypeScript builds:

```bash
npm run watch
```

## Automated validation

The pull-request workflow:

1. verifies that all authored executable source is TypeScript
2. type-checks the extension host, webviews, static-site adapters and `.mts` scripts
3. builds the VS Code extension and static site
4. performs a binary codec round trip
5. launches a real headless browser
6. uploads an image and vectorises it to SVG
7. continues into the SVG track generator
8. downloads and validates the generated `.bin`
9. uploads that `.bin` to the browser visualiser
10. packages the VS Code extension as a VSIX
11. uploads the static site, screenshots and VSIX as workflow artifacts

## GitHub Pages

The workflow at `.github/workflows/pages.yml` builds and deploys `dist/site/` from the `main` branch using GitHub's official Pages actions.

Set **Settings → Pages → Source** to **GitHub Actions**.

## Packaging the extension

```bash
npm run package-extension
```

## Author

Kitty Crow  
https://kittycrow.dev

## Licence

MIT
