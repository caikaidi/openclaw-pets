import { afterEach, describe, expect, it, vi } from "vitest";
import { PetStateProjector } from "../src/state-projector.js";

afterEach(() => vi.useRealTimers());

describe("PetStateProjector", () => {
  it("keeps concurrent pet interactions isolated", () => {
    const projector = new PetStateProjector(() => "2026-08-16T12:00:00.000Z");
    projector.beginRun({
      runId: "run-a",
      sessionKey: "agent:main:pets:interaction-a",
      interactionId: "interaction-a",
    });
    projector.beginRun({
      runId: "run-b",
      sessionKey: "agent:main:pets:interaction-b",
      interactionId: "interaction-b",
    });
    projector.beginTool({ runId: "run-b", toolCallId: "tool-b", toolName: "bash" });

    expect(projector.snapshot("interaction-a")).toMatchObject({
      state: "thinking",
      runId: "run-a",
      interactionId: "interaction-a",
    });
    expect(projector.snapshot("interaction-b")).toMatchObject({
      state: "working",
      runId: "run-b",
      interactionId: "interaction-b",
    });

    projector.endRun({ runId: "run-b", success: true });
    expect(projector.snapshot("interaction-a")).toMatchObject({ state: "thinking", runId: "run-a" });
    expect(projector.snapshot("interaction-b")).toMatchObject({ state: "succeeded" });
  });

  it("projects concurrent OpenClaw work using attention priority", () => {
    const projector = new PetStateProjector(() => "2026-08-16T12:00:00.000Z");

    projector.beginRun({ runId: "run-a", sessionKey: "alpha", interactionId: "interaction-shared" });
    projector.beginRun({ runId: "run-b", sessionKey: "beta", interactionId: "interaction-shared" });
    expect(projector.snapshot("interaction-shared")).toMatchObject({ state: "thinking", runId: "run-b" });

    projector.beginTool({
      runId: "run-a",
      sessionKey: "alpha",
      toolCallId: "tool-a-1",
      toolName: "web_search",
    });
    expect(projector.snapshot("interaction-shared")).toMatchObject({ state: "working", runId: "run-a" });

    projector.endTool({ runId: "run-a", toolCallId: "tool-a-1" });
    expect(projector.snapshot("interaction-shared")).toMatchObject({ state: "thinking", runId: "run-a" });

    projector.beginTool({
      runId: "run-a",
      sessionKey: "alpha",
      toolCallId: "tool-a-2",
      toolName: "web_search",
    });

    projector.requireInput({
      runId: "run-b",
      sessionKey: "beta",
      approvalId: "approval-b-1",
      detail: "Approval required",
    });
    expect(projector.snapshot("interaction-shared")).toMatchObject({ state: "needs_input", runId: "run-b" });

    projector.endRun({ runId: "run-b", success: true });
    expect(projector.snapshot("interaction-shared")).toMatchObject({ state: "working", runId: "run-a" });

    projector.endRun({ runId: "run-a", success: true });
    expect(projector.snapshot("interaction-shared")).toMatchObject({ state: "succeeded" });
  });

  it("keeps a run working until every parallel tool finishes", () => {
    const projector = new PetStateProjector(() => "2026-08-16T12:00:00.000Z");
    projector.beginRun({ runId: "run-parallel", interactionId: "interaction-parallel" });
    projector.beginTool({ runId: "run-parallel", toolCallId: "tool-1", toolName: "web_search" });
    projector.beginTool({ runId: "run-parallel", toolCallId: "tool-2", toolName: "read" });

    projector.endTool({ runId: "run-parallel", toolCallId: "tool-1" });
    expect(projector.snapshot("interaction-parallel")).toMatchObject({
      state: "working",
      runId: "run-parallel",
      detail: "read",
    });

    projector.endTool({ runId: "run-parallel", toolCallId: "tool-2" });
    expect(projector.snapshot("interaction-parallel")).toMatchObject({ state: "thinking", runId: "run-parallel" });
  });

  it("restores the underlying run state after an approval resolves", () => {
    const projector = new PetStateProjector(() => "2026-08-16T12:00:00.000Z");
    projector.beginRun({ runId: "run-approval", interactionId: "interaction-approval" });
    projector.beginTool({ runId: "run-approval", toolCallId: "tool-1", toolName: "bash" });
    projector.requireInput({
      runId: "run-approval",
      approvalId: "approval-1",
      detail: "Approve command",
    });
    expect(projector.snapshot("interaction-approval")).toMatchObject({ state: "needs_input", detail: "Approve command" });

    projector.resolveInput({ runId: "run-approval", approvalId: "approval-1" });
    expect(projector.snapshot("interaction-approval")).toMatchObject({ state: "working", detail: "bash" });
  });

  it("returns a terminal interaction to idle after the configured display interval", () => {
    vi.useFakeTimers();
    const projector = new PetStateProjector(() => "2026-08-16T12:00:00.000Z", 3_000);
    projector.beginRun({
      runId: "run-terminal",
      sessionKey: "agent:main:pets:interaction-terminal",
      interactionId: "interaction-terminal",
    });
    projector.endRun({ runId: "run-terminal", success: true });
    expect(projector.snapshot("interaction-terminal")).toMatchObject({ state: "succeeded" });

    vi.advanceTimersByTime(3_000);
    expect(projector.snapshot("interaction-terminal")).toMatchObject({ state: "idle" });
  });
});
