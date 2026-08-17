# Pet Pack format v1

A Pet Pack is a directory of inert local data:

```text
active/
├── manifest.json
└── assets/
    └── spritesheet.webp
```

The current macOS development build reads the active pack from:

```text
~/Library/Application Support/dev.openclaw.pets/pet-packs/active/
```

If the directory is absent or invalid, the app uses its original CSS fallback
pet. A settings action reloads the active pack without restarting Gateway.

## Manifest

```json
{
  "formatVersion": 1,
  "id": "org.example.fox",
  "version": "1.0.0",
  "name": "Example Fox",
  "license": "CC-BY-4.0",
  "engine": { "min": "0.1.0" },
  "assets": {
    "main": {
      "path": "assets/spritesheet.webp",
      "mimeType": "image/webp",
      "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "width": 1536,
      "height": 1872,
      "frameWidth": 256,
      "frameHeight": 208
    }
  },
  "states": {
    "idle": {
      "asset": "main",
      "frames": [0, 1, 2, 3],
      "fps": 8,
      "loop": true,
      "visibleBottom": 175
    },
    "working": {
      "asset": "main",
      "frames": [12, 13, 14, 15],
      "fps": 10,
      "loop": true
    }
  }
}
```

`idle` is required and is the fallback for omitted states. Frame numbers are
row-major. Total asset dimensions must be evenly divisible by the declared
single-frame dimensions, and every frame index must fit that grid.

`visibleBottom` is optional and uses a pixel coordinate inside one frame. When
present, the desktop aligns that visible bottom with the pet viewport bottom
so sprite sheets with transparent padding remain grounded. It must be between
1 and the declared frame height. Packs that omit it preserve full-frame
alignment.

## Allowed data

- Manifest: UTF-8 JSON, at most 64 KiB.
- Assets: local PNG or WebP regular files only.
- Per-asset limit: 16 MiB.
- Total assets limit: 32 MiB.
- Maximum nested asset depth: four directories below `assets/`.
- Every declared asset must match its lowercase SHA-256.

The format rejects JavaScript, HTML, SVG, native libraries, shaders, links,
special files, absolute paths, path traversal, and external URLs.

## Licensing

The `license` field is mandatory. It describes the pack's visual assets, not
the OpenClaw Pets code. Pack authors must have redistribution rights and
should include any required attribution alongside the pack. Format
compatibility is not evidence that an asset is legally redistributable.
