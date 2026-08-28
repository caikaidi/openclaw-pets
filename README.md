# OpenClaw Pets

OpenClaw Pets is an open-source native desktop companion for
[OpenClaw](https://github.com/openclaw/openclaw). It turns pet-originated
tasks, tool calls, approvals, and voice activity into a small always-on-top
pet, and gives the user an explicit way to add observations to OpenClaw's
context. Activity from unrelated OpenClaw sessions does not change the pet.

This repository is a **greenfield rewrite**. It does not fork or depend on the
earlier desktop-pet repository used during product discovery, and it does not
include privately evaluated discovery artwork.

> Status: `0.5.1` public beta. Source builds are supported. Official notarized
> macOS binaries and automated release publishing are not available yet.

## Architecture

```text
┌──────────────────────── Native desktop companion ────────────────────────┐
│ transparent window · push-to-talk · Todo/Apple export · Pet Pack renderer│
└───────────────────────────────┬───────────────────────────────────────────┘
                                │ official Gateway WebSocket protocol
┌───────────────────────────────▼───────────────────────────────────────────┐
│ OpenClaw Gateway + OpenClaw Pets plugin                                  │
│ pets.* RPC · batch ASR providers · activity corpus · routing policy      │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │ hooks and additive memory interfaces
┌───────────────────────────────▼───────────────────────────────────────────┐
│ OpenClaw                                                                 │
│ agents · models · tools · sessions · approvals · Memory                  │
└───────────────────────────────────────────────────────────────────────────┘

Pet Pack (manifest + PNG/WebP only) ───────────────► desktop renderer
```

OpenClaw remains the only agent runtime. The desktop app does not contain a
second model router, tool executor, or competing memory system.

## Repository map

- `apps/desktop` — Vue + Tauri native companion for macOS.
- `packages/openclaw-plugin` — Gateway plugin, pluggable batch ASR, scoped
  task-state projection, and additive activity corpus.
- `packages/protocol` — versioned `pets.*` RPC names and semantic state types.
- `packages/petpack` — validation for inert, replaceable raster Pet Packs.
- `docs/architecture.md` — process, trust, and data-flow decisions.
- `docs/pet-pack.md` — public Pet Pack v1 format.

## Current vertical slice

- Stable states: `offline`, `idle`, `listening`, `transcribing`, `thinking`,
  `working`, `needs_input`, `speaking`, `succeeded`, and `failed`.
- Click-to-record with one compressed recording submitted after the user
  stops. ASR runs through a plugin-configured primary provider and optional
  fallback provider.
- Conservative voice routing: explicit prefixes win; otherwise a bounded,
  tool-free OpenClaw classifier records ordinary observations automatically
  and asks the user only for likely task requests. It never auto-executes.
- User-controlled Journal with replaceable local/HTTP Providers, pause,
  cross-source listing, optimistic-lock editing, and retract operations.
- A right-click Todo view generated only from the recent 30-day Journal by a
  bounded, tool-free model call. Each item cites its source observations and
  can be added explicitly to Apple Calendar or Reminders.
- Optional, bounded OpenClaw prompt supplementation; disabled by default.
- Code-free Pet Packs with path, type, geometry, and SHA-256 validation.
  Petdex ZIPs or directories downloaded from codex-pets.net can be imported,
  previewed, and activated locally without granting them code execution.
- Device-bound Gateway authentication with the Ed25519 private key and tokens
  stored in the operating-system credential store.
- A transparent window whose status and decision surfaces expand above the
  pet without moving it away from the physical screen edge. Recording status
  remains visible between an open menu and the pet, while sprite interaction
  follows the active frame's opaque pixels instead of its transparent box.
- Multiple independently paired companions can share one remote Gateway and
  Journal while keeping recording, task state, animation, and active Pet Pack
  local to each device.

## Development

Prerequisites:

- Node.js 22.19 or newer
- pnpm 10 through Corepack
- Rust stable toolchain
- macOS 13 or newer for the current desktop target
- OpenClaw `2026.8.1-beta.2` or newer

```bash
corepack pnpm install
corepack pnpm check
corepack pnpm --filter @openclaw-pets/desktop tauri:dev
```

Rust checks run from `apps/desktop/src-tauri`:

```bash
cargo fmt --check
cargo check
cargo test --lib
```

For a source installation of both the Gateway plugin and desktop app, see
[docs/installation.md](docs/installation.md).

The first desktop launch opens Settings and does not contact a Gateway until
the user saves a WebSocket address. A Gateway connection credential, when
required by the operator's Gateway authentication policy, is entered in the
app and stored in the system credential store. Do not place credentials in
source files, environment examples, issue reports, or logs.

## Privacy defaults

- The microphone starts only after a direct click. Audio remains in memory,
  is submitted once after stop, and is not retained after transcription.
- Automatic activity injection is off by default.
- Activity observations are explicitly labeled untrusted data, never
  instructions.
- Capturing can be paused from the desktop app.
- Individual observations can be retracted through the configured Journal
  Provider. Physical retention is controlled by that Provider's policy.
- Apple Calendar and Reminders receive only the Todo whose button the user
  clicks; macOS controls the corresponding Automation permission.
- Pet Packs cannot contain JavaScript, HTML, SVG, native code, shaders, or
  external URLs.

See [SECURITY.md](SECURITY.md) for reporting and trust-boundary details.

## Open-source scope

Code in this repository is licensed under Apache-2.0. Each third-party Pet
Pack must declare its own asset license. A pack's license is not inherited
from this repository merely because the manifest format is compatible.

See [ASSET-LICENSES.md](ASSET-LICENSES.md) for bundled visual assets.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing protocol or Pet Pack
format changes. Both formats are versioned compatibility boundaries.
Official binaries must follow the signed and notarized process in
[docs/releasing.md](docs/releasing.md).
