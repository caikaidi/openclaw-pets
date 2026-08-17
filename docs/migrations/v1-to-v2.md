# Pets Protocol v1 to v2

Protocol v2 replaces the experimental live Talk Relay path with interaction-scoped batch transcription.

## Breaking changes

- Clients submit a complete recording through `pets.transcription.create` after recording stops.
- `features.talkTranscription` is removed. Read `features.batchTranscription` instead.
- `UtteranceRouteResult.targetSessionKey` is removed. Agent session keys are derived from the desktop-created `interactionId`.
- `routing.default` is removed. Unmatched utterances always require user confirmation or clarification.
- Pet state is queried and emitted per `interactionId`; unrelated OpenClaw sessions do not affect the desktop pet.

## Client migration

1. Require `protocolVersion === 2` from `pets.capabilities` and reject other versions.
2. Create and persist an `interactionId` before recording.
3. Submit the stopped recording once through `pets.transcription.create`.
4. Use the same `interactionId` for routing, status queries, and agent-session correlation.
5. Display an explicit upgrade message when the plugin protocol is incompatible.

There is no in-place v1 compatibility shim because v1 could associate global Agent state with the pet. Upgrade the desktop and plugin together.
