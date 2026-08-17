import { describe, expect, it } from "vitest";
import { resolveDisplayState, shouldApplyInteractionStatus } from "../src/runtime/display-state.js";

describe("desktop display state", () => {
  it("prioritizes the active desktop interaction over tracked backend activity", () => {
    expect(resolveDisplayState({ connected: false, backendState: "working" })).toBe("offline");
    expect(resolveDisplayState({ connected: true, backendState: "working", interactionState: "listening" })).toBe("listening");
    expect(resolveDisplayState({ connected: true, backendState: "working", interactionState: "needs_input" })).toBe("needs_input");
    expect(resolveDisplayState({ connected: true, backendState: "working", interactionState: "succeeded" })).toBe("succeeded");
  });

  it("uses the plugin projection when no local interaction overrides it", () => {
    expect(resolveDisplayState({ connected: true, backendState: "thinking" })).toBe("thinking");
    expect(resolveDisplayState({ connected: true })).toBe("idle");
  });

  it("accepts backend state only for the desktop's active interaction", () => {
    expect(shouldApplyInteractionStatus("interaction-a", {
      protocolVersion: 2,
      revision: 1,
      state: "working",
      changedAt: "2026-08-17T02:00:00.000Z",
      interactionId: "interaction-a",
    })).toBe(true);
    expect(shouldApplyInteractionStatus("interaction-a", {
      protocolVersion: 2,
      revision: 2,
      state: "needs_input",
      changedAt: "2026-08-17T02:00:01.000Z",
      interactionId: "interaction-b",
    })).toBe(false);
  });
});
