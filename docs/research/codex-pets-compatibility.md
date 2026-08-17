# Codex Pets / Petdex compatibility research

## Scope

This note evaluates whether OpenClaw Pets can import pets distributed through
[codex-pets.net](https://codex-pets.net/) without coupling its core protocol
to Codex or to an undocumented website API.

## Primary-source findings

### Codex Pets are a presentation layer

Codex documents Pets as a visual observer of task state. The documented
user-facing states are Running, Needs input, Ready, and Blocked. Changing a
Pet changes the visual representation, not task execution.

Source: [Codex app features](https://developers.openai.com/codex/app/features/)

### Petdex distributes downloadable visual resources

The public Petdex site presents downloadable pets built around a `pet.json`
description and a spritesheet, and describes the pets as usable with agents
other than Codex.

Source: [codex-pets.net](https://codex-pets.net/)

### The downloadable format was verified, but no stable catalog API was found

No OpenAPI document or public catalog API stability guarantee was identified.
The importer therefore never scrapes or calls an undocumented catalog API.

A real downloaded package was inspected locally without committing its
artwork. It contained only `pet.json` and `spritesheet.webp`. The verified
fields were `id`, `displayName`, `description`, `spritesheetPath`,
`spriteVersionNumber`, and `kind`. The public validator describes fixed
192×208 frames, eight columns, a nine-row v1 atlas (`1536×1872`), and an
eleven-row v2 atlas (`1536×2288`). The first nine rows are idle,
running-right, running-left, waving, jumping, failed, waiting, running, and
review; v2 adds right- and left-looking rows.

Consequences:

- Do not scrape or depend on Petdex's internal catalog endpoints.
- Encode only the verified fields and fixed atlas layouts above.
- Treat the verified package as evidence for a versioned import adapter, not
  as permission to redefine the OpenClaw Pet Pack format.
- Unknown Petdex versions must fail closed with an actionable error.

## Current OpenClaw Pets format

OpenClaw Pets already has a stricter inert-data format documented in
[`docs/pet-pack.md`](../pet-pack.md) and implemented by
[`packages/petpack/src/index.ts`](../../packages/petpack/src/index.ts).

Its v1 manifest requires:

- `formatVersion`, package identity, version, asset license, and minimum engine;
- local PNG/WebP assets with lowercase SHA-256;
- total image and single-frame dimensions;
- row-major frame indexes;
- per-state fps, looping, and optional `visibleBottom`;
- an `idle` fallback;
- states drawn from the OpenClaw Pets semantic-state protocol.

The desktop now keeps validated local installs behind the native Pet Pack
manager and an atomic active selection. The browser layer receives only
canonical, validated pack data.

## Semantic compatibility

Codex's four public task states and OpenClaw Pets' semantic states are different
abstractions.

OpenClaw Pets currently supports:

- `offline`
- `idle`
- `listening`
- `transcribing`
- `thinking`
- `working`
- `needs_input`
- `speaking`
- `succeeded`
- `failed`

A Petdex adapter should translate verified source animations into these states.
Codex/Petdex names must not enter the core protocol.

Where a source pet lacks an OpenClaw-specific state, the adapter uses a
nearest-state fallback and ultimately `idle`. The import mapping stays inside
the adapter; Petdex row names never enter the public Pets Protocol.

## Recommended import flow

The first compatible release should use an explicit local-import flow:

1. Open codex-pets.net in the user's browser.
2. The user downloads a pet.
3. In OpenClaw Pets settings, choose **Import Pet**.
4. Select the downloaded ZIP or directory.
5. Inspect and validate it as untrusted input.
6. Convert supported source data into the internal Pet Pack representation.
7. Preview every mapped OpenClaw state.
8. Activate it or cancel without changing the current pet.

Do not implement an in-app Petdex catalog until Petdex publishes a stable,
versioned API and redistribution terms suitable for that use.

## Security requirements

Downloaded packs are untrusted. Import must reject:

- ZIP path traversal and absolute paths;
- symlinks and special files;
- excessive expanded size, file count, nesting, or per-file size;
- scripts, HTML, SVG, shaders, native libraries, and external URLs;
- invalid or unsupported `pet.json`;
- image MIME spoofing;
- dimensions or frame indexes outside the decoded image;
- undeclared extra executable content.

Conversion should produce the existing inert OpenClaw Pet Pack structure and
reuse its validation and hashing path.

## Licensing and redistribution

Compatibility does not grant redistribution rights.

A site or tool being MIT-licensed does not automatically license every
contributor-supplied sprite. Each imported pet must retain its own asset license
and attribution. OpenClaw Pets may let a user import a pet for their own use,
but should not mirror, bundle, or publish that pet unless its asset license
explicitly permits redistribution.

The internal `license` field remains mandatory. If the source pack does not
provide a clear license, the importer should label it as local-only and prevent
export or bundling.

## Recommended decision

Support Petdex as an **import source**, not as a runtime dependency:

- keep OpenClaw Pet Pack v1 as the canonical internal format;
- add a versioned `PetdexImporter` adapter;
- import local ZIP/directories only in the first release;
- accept only the verified fields and atlas versions;
- preview state mappings before activation;
- never silently redistribute imported artwork.
