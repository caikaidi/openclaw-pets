# Architecture

## Decision

OpenClaw Pets is one product with three independently replaceable layers:

1. **OpenClaw plugin** — trusted control plane inside Gateway.
2. **Native companion** — transparent desktop UI and microphone owner.
3. **Pet Pack** — untrusted, inert raster data.

The plugin and companion communicate over the official OpenClaw Gateway
WebSocket protocol. The plugin extends that protocol only through a small,
versioned `pets.*` RPC surface and one namespaced state-change event.

## Why the GUI is not inside the plugin

The OpenClaw Plugin SDK is designed for hooks, RPC, services, and memory
contributions. It is not a lifecycle or distribution boundary for a signed,
notarized native application with a transparent window and microphone
permission. Keeping the companion separate also isolates animation or window
crashes from Gateway.

## Ownership

| Concern | Owner |
|---|---|
| Agent/model/tool execution | OpenClaw |
| Session creation and approvals | OpenClaw |
| Pet-originated-task-to-semantic-state projection | plugin |
| Voice routing policy | plugin configuration |
| ASR Provider selection and credentials | plugin configuration / OpenClaw SecretRef |
| Activity persistence | configured Journal Provider |
| Journal Provider selection and memory corpus adapter | plugin |
| Microphone capture and compressed batch upload | desktop |
| Transparent window and interaction | desktop |
| Semantic-state-to-animation mapping | Pet Pack |
| Private key and Gateway tokens | operating-system credential store |

The desktop app never knows domain-specific concepts such as a particular
user's journal schema. It asks the plugin to route an utterance, then performs
the returned generic action.

## Trust boundaries

### Desktop → Gateway

The desktop uses the official browser-safe Gateway client under the generic
third-party UI client identity. Its persistent Ed25519 private key is created
and used in Rust; JavaScript receives only the public identity and a signature
operation. Gateway connection credentials and issued device tokens use the
operating-system credential store.

### Activity observations

An observation is user-supplied context data, not a prompt. The protocol
rejects unknown fields, bounds text and metadata, and the memory supplement
labels every result as untrusted. Automatic prompt supplementation is opt-in
and bounded to ten observations, with a default of three.

### Pet Packs

Pet Packs are never executed. The native reader accepts only regular PNG and
WebP files below fixed size limits, rejects links and special files, and does
not follow external URLs. The desktop validates the manifest and verifies the
SHA-256 of every declared asset before rendering it.

## State model

Every desktop recording gets an `interactionId`. Sessions created by the
companion carry that id in `agent:<agent>:pets:<interactionId>`. The plugin
projects only those sessions; WebChat, cron, and other Agent runs cannot move
the pet out of idle. The desktop gives its active interaction higher display
priority:

1. disconnected → `offline`
2. local recording → `listening`
3. plugin batch ASR → `transcribing`
4. local route confirmation → `needs_input`
5. matching OpenClaw session → `thinking` or `working`
6. terminal result for three seconds → `succeeded` or `failed`, then `idle`

Pet Packs map these meanings to artwork. Animation filenames and frame rows
never appear in the protocol.

## ASR model

The desktop never receives Provider credentials. It records one compressed
audio blob and submits it to `pets.transcription.create` after the user stops.
The plugin validates MIME type, duration, decoded size, and interaction id,
then invokes the configured primary ASR Provider. The optional fallback runs
only after the primary fails.

Built-in Provider adapters are `bailian-token-plan`, `dashscope`,
`openai-compatible`, and `webhook`. API keys are SecretInput fields owned by
Gateway configuration. The desktop receives only availability, Provider names,
the transcript, and an optional upstream request id. Audio is processed in
memory and is never added to activity storage.

## Context model

OpenClaw Pets contributes an additive memory corpus; it does not replace
OpenClaw Memory. Activity capture can be paused. Observations are read, written,
and retracted through one configured Journal Provider. There is no local cache
or dual-write path when a remote Provider is selected.

The open-source default is a local JSONL Provider. Deployments that already
have an Activity Journal can select the versioned HTTP Provider contract. The
desktop remains Provider-agnostic and requests the user's local calendar-day
window through `pets.activity.list`. Remote failures return explicit gaps;
they are never rendered as an empty Journal. Automatic per-run context
preparation is disabled unless the operator explicitly enables it.
