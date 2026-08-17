import { describe, expect, it, vi } from "vitest";
import type { ActivityObservation } from "@openclaw-pets/protocol";
import { ActivityEditConflictError, saveActivityEdit } from "../src/runtime/activity-editor.js";

const original: ActivityObservation = {
  id: "shared-activity",
  occurredAt: "2026-08-17T08:00:00.000Z",
  source: "external_voice",
  text: "原始记录",
  revision: "revision-1",
};

describe("activity editor", () => {
  it("saves through the versioned RPC and returns the canonical observation", async () => {
    const updated = { ...original, text: "修正记录", revision: "revision-2", editedAt: "2026-08-17T08:30:00.000Z" };
    const request = vi.fn().mockResolvedValue({ status: "updated", observation: updated });

    await expect(saveActivityEdit(request, original, "  修正记录  ")).resolves.toEqual(updated);
    expect(request).toHaveBeenCalledWith("pets.activity.update", {
      id: original.id,
      text: "修正记录",
      expectedRevision: "revision-1",
    });
  });

  it("surfaces the newer cross-device value instead of overwriting it", async () => {
    const current = { ...original, text: "另一台电脑已修改", revision: "revision-2" };
    const request = vi.fn().mockResolvedValue({ status: "conflict", observation: current });

    await expect(saveActivityEdit(request, original, "陈旧覆盖")).rejects.toEqual(
      new ActivityEditConflictError(current),
    );
  });
});
