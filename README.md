# Sandsara Track Viewer

A Visual Studio Code extension for decoding, validating and previewing binary track files used by Sandsara kinetic sand tables.

## Features

- Opens Sandsara `.bin` track files as a visual preview
- Decodes signed Cartesian X and Y coordinates
- Validates the six-byte record structure
- Displays the number of points and coordinate limits
- Shows the starting and finishing positions
- Warns about points outside the nominal drawing area

## Sandsara binary format

Each point occupies six bytes:

| Offset | Size | Description |
|---:|---:|---|
| 0 | 2 bytes | Signed 16-bit X coordinate, little-endian |
| 2 | 1 byte | Comma separator, `0x2C` |
| 3 | 2 bytes | Signed 16-bit Y coordinate, little-endian |
| 5 | 1 byte | Newline separator, `0x0A` |

The file contains no header or footer. Its total size must be divisible by six.

## Usage

Open a file named in the following form:

`Sandsara-trackNumber-0004.bin`

The extension displays the decoded drawing path instead of raw binary data.

You can also right-click a compatible file and select:

`Open With...` → `Sandsara Track Preview`

## Development

Install dependencies:

    npm install

Compile:

    npm run compile

Press `F5` in Visual Studio Code to launch an Extension Development Host.

## Packaging

    npm run package-extension

## Author

Kitty Crow  
https://kittycrow.dev

## Licence

MIT
