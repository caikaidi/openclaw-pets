import { describe, expect, it } from "vitest";
import { shouldApplyInteractionStatus } from "../src/runtime/display-state.js";
import { createDeviceInteractionId } from "../src/runtime/interaction-id.js";

describe("multiple companion computers", () => {
  it("names simultaneous interactions by the independently paired device", async () => {
    const uuid = "11111111-2222-4333-8444-555555555555";
    const first = await createDeviceInteractionId(
      async () => ({ deviceId: "a".repeat(64) }),
      () => uuid,
    );
    const second = await createDeviceInteractionId(
      async () => ({ deviceId: "b".repeat(64) }),
      () => uuid,
    );

    expect(first).not.toBe(second);
    expect(first.length).toBeLessThanOrEqual(128);
    expect(shouldApplyInteractionStatus(first, { interactionId: first })).toBe(true);
    expect(shouldApplyInteractionStatus(first, { interactionId: second })).toBe(false);
  });
});
