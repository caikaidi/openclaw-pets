# OpenClaw Pets plugin

This package is the trusted Gateway-side half of OpenClaw Pets. It runs
operator-configured batch ASR, projects only pet-originated OpenClaw work into
stable semantic states, and exposes user-controlled activity observations as
an additive memory corpus through a replaceable Journal Provider.

The plugin does not create desktop windows, own microphone permission, bundle
pet assets, replace OpenClaw Memory, or execute a separate agent router.

ASR supports `bailian-token-plan`, `dashscope`, `openai-compatible`, and
`webhook` adapters. Configure a primary Provider and, optionally, one fallback
through `plugins.entries.openclaw-pets.config.asr`. Provider API keys are
declared SecretInput fields and should be supplied through OpenClaw SecretRef,
not committed as literal values.

Automatic context injection is disabled by default. The desktop companion can
still append observations and request a context preview through the scoped
`pets.*` Gateway RPC methods.

`plugins.entries.openclaw-pets.config.journal.provider` defaults to `local`.
Set it to `http` with a `baseUrl` and SecretRef-backed `apiKey` to use a remote
implementation of the [Journal Provider contract](../../docs/journal-provider.md).
Remote mode never writes a second local copy. Missing or unavailable remote
data is reported as a gap rather than an empty activity list.
