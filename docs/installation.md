# Source installation

OpenClaw Pets desktop `0.5.1` with Gateway plugin `0.5.1` is a public beta.
Install both from one clean source checkout. Official notarized macOS binaries
are not published yet.

## Prerequisites

- macOS 13 or newer on Apple silicon
- OpenClaw `2026.8.1-beta.2` or newer
- Node.js 22.19 or newer with Corepack
- Rust stable toolchain

## Build and install the Gateway plugin

```bash
git clone https://github.com/caikaidi/openclaw-pets.git
cd openclaw-pets
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm --filter @openclaw-pets/plugin build
mkdir -p dist
cd packages/openclaw-plugin
npm pack --pack-destination ../../dist
```

Install the resulting archive with OpenClaw's local package installer:

```bash
openclaw plugins install npm-pack:/absolute/path/to/openclaw-pets/dist/openclaw-pets-plugin-0.5.1.tgz
```

Configure ASR, routing, and the Journal Provider through the OpenClaw plugin
configuration. Keep every Provider credential in an OpenClaw SecretRef. The
desktop app never needs an ASR or Journal API key.

Plugin installation or configuration changes may require a Gateway restart.
Coordinate that restart with other active OpenClaw sessions.

## Build and install the desktop app

From the repository root:

```bash
corepack pnpm --filter @openclaw-pets/desktop tauri:build
```

Open the generated DMG under
`apps/desktop/src-tauri/target/release/bundle/dmg/` and drag OpenClaw Pets to
Applications. A local source build is not notarized; follow
[releasing.md](releasing.md) before distributing a binary to other users.

On first launch:

1. enter the Gateway WebSocket address and connection credential in Settings;
2. approve the new device in OpenClaw;
3. allow microphone access when macOS asks;
4. install a licensed Pet Pack, or use the built-in CSS fallback pet.

Each additional computer repeats pairing with its own device identity. Use an
authenticated `wss://` Gateway address when connecting remotely. Pet Pack
selection and current interaction state stay on that computer; Journal data is
shared by the configured Provider.

Never paste Gateway, ASR, or Journal credentials into issue reports, shell
arguments, source files, or Pet Pack manifests.
