import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ActivityStore } from "../src/activity-store.js";
import { PetStateProjector } from "../src/state-projector.js";

describe("two companion clients on one Gateway", () => {
  it("shares Journal writes while projecting each device interaction independently", async () => {
    const journal = new ActivityStore(await mkdtemp(join(tmpdir(), "openclaw-pets-two-devices-")));
    const projector = new PetStateProjector();
    const first = `${"a".repeat(64)}.11111111-2222-4333-8444-555555555555`;
    const second = `${"b".repeat(64)}.11111111-2222-4333-8444-555555555555`;

    await Promise.all([
      journal.append({
        id: "first-device-journal",
        occurredAt: "2026-08-17T12:00:00.000Z",
        source: "desktop_voice",
        text: "First device observation",
        interactionId: first,
      }),
      journal.append({
        id: "second-device-journal",
        occurredAt: "2026-08-17T12:00:01.000Z",
        source: "desktop_voice",
        text: "Second device observation",
        interactionId: second,
      }),
    ]);
    projector.beginRun({ runId: "first-run", interactionId: first });
    projector.beginRun({ runId: "second-run", interactionId: second });
    projector.beginTool({ runId: "first-run", toolCallId: "tool-a", toolName: "browser" });

    expect((await journal.page({ limit: 10 })).observations.map((item) => item.id)).toEqual([
      "second-device-journal",
      "first-device-journal",
    ]);
    expect(projector.snapshot(first)).toMatchObject({ interactionId: first, state: "working" });
    expect(projector.snapshot(second)).toMatchObject({ interactionId: second, state: "thinking" });
    projector.reset();
  });
});
