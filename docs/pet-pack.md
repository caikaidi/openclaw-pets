# Pet Pack format v1

A Pet Pack is a directory of inert local data:

```text
active/
├── manifest.json
├── LICENSE.txt
├── ATTRIBUTION.txt
└── assets/
    └── spritesheet.webp
```

The macOS app keeps imported packs and its active selection under:

```text
~/Library/Application Support/dev.openclaw.pets/pet-packs/
├── installed/
└── active.json
```

The earlier `pet-packs/active/` directory remains a local compatibility
fallback. If no valid pack is selected, the app uses its original CSS fallback
pet. Pet selection is local to each companion computer and never restarts
Gateway.

## Importing from Petdex

Open Settings, choose **Browse Petdex**, download a pet from
`https://codex-pets.net/`, then import its ZIP or directory. The first supported
Petdex adapter recognizes the verified `pet.json` fields `id`, `displayName`,
`spritesheetPath`, optional `spriteVersionNumber`, and optional metadata. It
accepts the documented fixed 192×208 frames in an eight-column spritesheet:
v1 has nine rows (`1536×1872`) and v2 has eleven (`1536×2288`).

Import validates and stages the source, converts supported animation rows into
OpenClaw semantic states, and opens a preview. The current pet changes only
after **Activate**. Cancellation or any validation failure leaves the active
selection unchanged. OpenClaw Pets opens the public website in the system
browser; it does not scrape its catalog, mirror artwork, or depend on an
undocumented site API.

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
- Optional licensing and attribution: plain `LICENSE.txt` and
  `ATTRIBUTION.txt` files at the package root.
- Assets: local PNG or WebP regular files only.
- Per-asset limit: 16 MiB.
- Total assets limit: 32 MiB.
- Maximum nested asset depth: four directories below `assets/`.
- Every declared asset must match its lowercase SHA-256.

The format rejects JavaScript, HTML, SVG, native libraries, shaders, links,
special files, absolute paths, path traversal, and external URLs.

ZIP and directory imports add limits on expanded size, file count, nesting,
duplicate paths, links, and special files. Raster MIME and dimensions are
verified from decoded content rather than trusting filenames.

## Licensing

The `license` field is mandatory. It describes the pack's visual assets, not
the OpenClaw Pets code. Pack authors must have redistribution rights and
should include any required attribution alongside the pack. Format
compatibility is not evidence that an asset is legally redistributable.
Petdex metadata does not currently declare a reusable asset license, so those
imports are labeled `NOASSERTION` and treated as local-only unless the user has
separate redistribution rights.
