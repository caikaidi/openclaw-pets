import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ActivityStore } from "../src/activity-store.js";

describe("ActivityStore", () => {
  it("persists observations idempotently and exposes lexical context search", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openclaw-pets-store-"));
    const store = new ActivityStore(directory);
    const observation = {
      id: "obs-1",
      occurredAt: "2026-08-16T12:00:00.000Z",
      source: "voice" as const,
      text: "Finished the laser driver thermal test",
      tags: ["laser", "thermal"],
    };

    expect(await store.append(observation)).toEqual({ inserted: true, observation });
    expect(await store.append(observation)).toEqual({ inserted: false, observation });
    expect(await store.search("thermal driver", 5)).toEqual([
      expect.objectContaining({ id: "obs-1", text: observation.text }),
    ]);

    const reloaded = new ActivityStore(directory);
    expect(await reloaded.list({ limit: 10 })).toEqual([observation]);
    expect(await reloaded.delete("obs-1")).toBe(true);
    expect(await reloaded.delete("obs-1")).toBe(false);
    expect(await new ActivityStore(directory).list({ limit: 10 })).toEqual([]);
  });

  it("serializes concurrent deletions without resurrecting another record", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openclaw-pets-store-"));
    const store = new ActivityStore(directory);
    const observation = (id: string) => ({
      id,
      occurredAt: "2026-08-16T12:00:00.000Z",
      source: "text" as const,
      text: `Observation ${id}`,
    });
    await Promise.all([store.append(observation("one")), store.append(observation("two"))]);

    expect(await Promise.all([store.delete("one"), store.delete("two")])).toEqual([true, true]);
    expect(await new ActivityStore(directory).list({ limit: 10 })).toEqual([]);
  });

  it("keeps non-context transcripts in activity history without injecting them as context", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openclaw-pets-store-"));
    const store = new ActivityStore(directory);
    await store.append({
      id: "context-1",
      occurredAt: "2026-08-16T12:00:00.000Z",
      source: "voice",
      text: "The burn-in test is complete",
      route: "context",
    });
    await store.append({
      id: "agent-1",
      occurredAt: "2026-08-16T12:01:00.000Z",
      source: "voice",
      text: "Summarize the burn-in test",
      route: "agent",
    });
    await store.append({
      id: "confirm-1",
      occurredAt: "2026-08-16T12:02:00.000Z",
      source: "voice",
      text: "This still needs a routing decision",
      route: "confirm",
    });

    expect((await store.list({ limit: 10 })).map((item) => item.id)).toEqual([
      "confirm-1",
      "agent-1",
      "context-1",
    ]);
    expect((await store.searchContext("burn-in", 10)).map((item) => item.id)).toEqual(["context-1"]);
    expect(await store.getContext("confirm-1")).toBeNull();
  });

  it("pages only the requested time window and reports a complete local result", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openclaw-pets-store-"));
    const store = new ActivityStore(directory);
    await store.append({
      id: "yesterday",
      occurredAt: "2026-08-16T15:59:59.999Z",
      source: "voice",
      text: "Yesterday",
    });
    await store.append({
      id: "today",
      occurredAt: "2026-08-17T00:00:00.000+08:00",
      source: "voice",
      text: "Today in Asia/Shanghai",
    });

    expect(await store.page({
      limit: 10,
      startAt: "2026-08-16T16:00:00.000Z",
      endAt: "2026-08-17T16:00:00.000Z",
    })).toEqual({
      status: "ok",
      observations: [expect.objectContaining({ id: "today" })],
      gaps: [],
    });
  });

  it("reports a data gap when a pagination cursor was retracted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openclaw-pets-store-"));
    const store = new ActivityStore(directory);
    for (let index = 0; index < 3; index += 1) {
      await store.append({
        id: `cursor-${index}`,
        occurredAt: `2026-08-17T00:00:0${index}.000Z`,
        source: "voice",
        text: `Entry ${index}`,
      });
    }
    await store.retract("cursor-1");

    expect(await store.page({ limit: 2, cursor: "cursor-1" })).toEqual({
      status: "partial",
      observations: [],
      gaps: [{ source: "journal", reason: "Activity cursor is no longer available" }],
    });
  });
});
