# Pets Protocol v2 to v3

Protocol v3 accompanies OpenClaw Pets 0.4.0.

## Journal updates

- `pets.activity.update` is added.
- Journal observations may include opaque `revision` and ISO `editedAt`
  fields.
- Updates require the revision read by the client. Providers return
  `updated`, `conflict`, or `not_found`; a stale client must not overwrite a
  newer edit.

## Speech routing

- Explicit context and agent prefixes still win.
- Unmatched speech may be classified as `record_only` or `task_candidate` by a
  bounded, tool-free OpenClaw completion.
- Failure or uncertainty records the observation. Only task candidates open a
  manual route choice, and execution still requires explicit user action.

## Companion identity

- New desktop interactions are namespaced by the independently paired device
  id before the UUID.
- Gateways and Providers should treat the complete interaction id as opaque.
- Existing v2 interaction ids remain readable, but new clients use the
  namespaced form so simultaneous companions cannot collide.

## Pet Packs

- Desktop 0.4.0 adds local ZIP/directory import, preview, activation, removal,
  and a verified Petdex import adapter.
- This does not change canonical Pet Pack format v1 or grant redistribution
  rights to imported artwork.
