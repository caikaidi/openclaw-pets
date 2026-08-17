# OpenClaw Pets domain context

OpenClaw Pets is an OpenClaw-first desktop companion. OpenClaw remains the
only agent, model, tool, routing, and approval backend.

## Public seams

These seams come directly from the agreed product architecture and are the
only behavior boundaries covered by the first implementation tests:

1. **Pets Protocol** — versioned RPC names, activity observations, and stable
   semantic states shared by the plugin and desktop app.
2. **Pet Pack** — validation of code-free, locally loaded animation manifests.
3. **OpenClaw plugin** — Gateway RPC behavior, Journal Provider selection,
   bounded context supplementation, and runtime-to-pet state projection.
4. **Desktop Gateway adapter** — one authenticated Gateway connection that
   exposes status, activity submission, and batch transcription to the UI.
5. **ASR provider** — one complete recording enters the plugin and produces a
   normalized transcript plus the provider that actually served the request.
6. **Pets interaction state** — state belongs to one desktop-created
   interaction id. OpenClaw work from any other source cannot change the pet.
7. **Journal Provider** — the sole source of truth for activity observations.
   The built-in local Provider and remote HTTP Providers implement the same
   `page / append / retract / context` behavior without dual writes.

Implementation details behind these seams may change without changing tests.

## Ubiquitous language

- **Activity observation**: user-supplied or user-approved context data. It is
  untrusted data, never an instruction.
- **Journal Provider**: replaceable persistence boundary for activity history
  and context. Provider unavailability is a data gap, never an empty Journal.
- **Semantic state**: stable UI meaning independent of a particular Pet Pack.
- **Pet Pack**: inert local data containing a manifest and raster assets.
- **Context supplement**: bounded, additive context that does not replace
  OpenClaw Memory.
- **Companion app**: the native desktop process; it never becomes an agent
  runtime.
