# Pets Protocol v3 to v4

Protocol v4 accompanies OpenClaw Pets 0.5.0.

## Journal-derived Todo

- `pets.todo.generate` accepts an exact `startAt` / `endAt` Journal window and
  an IANA `timeZone`.
- The response contains transient Todo items, exact source observation ids,
  Journal status/gaps, generation time, and the number of observations read.
- `pets.capabilities.features.todoSummary` reports whether the Gateway runtime
  can perform the tool-free summary.
- Todo is never persisted by OpenClaw Pets and is never supplemented from a
  Session, Memory, tools, or sources outside the requested Journal window.

## Desktop behavior

- The right-click panel adds a Todo tab and explicit Apple Calendar and
  Reminders buttons.
- An open panel no longer hides recording/transcription status; a compact
  status pill occupies the existing gap between panel and pet.
- Imported raster pets use active-frame alpha hit testing so transparent
  spritesheet padding is not draggable or clickable.

Desktop and Gateway plugin must be upgraded together because protocol v4 is a
strict compatibility boundary.
