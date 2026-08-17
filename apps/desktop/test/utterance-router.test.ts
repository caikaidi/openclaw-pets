import { describe, expect, it, vi } from "vitest";
import { submitUtterance } from "../src/runtime/utterance-router.js";

describe("desktop utterance routing", () => {
  it("stores context through the plugin and dispatches agent work through OpenClaw", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "pets.utterance.route") return { route: "context", text: "Completed burn-in test" };
      if (method === "pets.activity.append") return { inserted: true };
      throw new Error(`unexpected ${method}`);
    });

    const result = await submitUtterance(request, {
      text: "note: Completed burn-in test",
      interactionId: "interaction-context-1",
      asrProvider: "bailian-token-plan",
      now: () => "2026-08-16T12:00:00.000Z",
      createId: () => "obs-1",
    });

    expect(result).toMatchObject({ kind: "context", inserted: true });
    expect(request).toHaveBeenNthCalledWith(2, "pets.activity.append", {
      observation: {
        id: "obs-1",
        occurredAt: "2026-08-16T12:00:00.000Z",
        source: "voice",
        text: "note: Completed burn-in test",
        asrProvider: "bailian-token-plan",
        route: "context",
        interactionId: "interaction-context-1",
      },
    });
  });

  it("creates a visible OpenClaw session after the user confirms an agent route", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "pets.utterance.route") {
        return { route: "agent", text: "Summarize the test", targetAgentId: "main" };
      }
      if (method === "pets.activity.append") return { inserted: true };
      if (method === "sessions.create") return { ok: true, key: "agent:main:pets:task-1", runId: "run-1" };
      throw new Error(`unexpected ${method}`);
    });

    const result = await submitUtterance(request, {
      text: "ask: Summarize the test",
      interactionId: "task-1",
      asrProvider: "dashscope",
      requestedRoute: "agent",
      now: () => "2026-08-16T12:00:00.000Z",
      createId: () => "task-1",
    });

    expect(result).toMatchObject({ kind: "agent", sessionKey: "agent:main:pets:task-1", runId: "run-1" });
    expect(request).toHaveBeenNthCalledWith(2, "pets.activity.append", {
      observation: {
        id: "task-1",
        occurredAt: "2026-08-16T12:00:00.000Z",
        source: "voice",
        text: "ask: Summarize the test",
        asrProvider: "dashscope",
        route: "agent",
        interactionId: "task-1",
      },
    });
    expect(request).toHaveBeenNthCalledWith(3, "sessions.create", {
      key: "agent:main:pets:task-1",
      agentId: "main",
      label: "Summarize the test",
      visibility: "shared",
      message: "Summarize the test",
    });
  });

  it("does not create an agent session before the user confirms a classified task candidate", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "pets.utterance.route") {
        return { route: "confirm", text: "Summarize the test" };
      }
      if (method === "pets.activity.append") return { inserted: true };
      throw new Error(`unexpected ${method}`);
    });

    const result = await submitUtterance(request, {
      text: "ask: Summarize the test",
      interactionId: "task-awaiting-confirmation",
      asrProvider: "bailian-token-plan",
    });

    expect(result).toEqual({
      kind: "confirm",
      text: "Summarize the test",
      transcript: "ask: Summarize the test",
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it("treats an explicit agent prefix as the user's execution choice", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "pets.utterance.route") {
        return {
          route: "agent",
          text: "Summarize the test",
          matchedPrefix: "ask:",
          targetAgentId: "main",
        };
      }
      if (method === "pets.activity.append") return { inserted: true };
      if (method === "sessions.create") {
        return { ok: true, key: "agent:main:pets:task-explicit-prefix" };
      }
      throw new Error(`unexpected ${method}`);
    });

    await expect(submitUtterance(request, {
      text: "ask: Summarize the test",
      interactionId: "task-explicit-prefix",
      asrProvider: "bailian-token-plan",
    })).resolves.toMatchObject({
      kind: "agent",
      sessionKey: "agent:main:pets:task-explicit-prefix",
    });
    expect(request).toHaveBeenLastCalledWith("sessions.create", expect.objectContaining({
      message: "Summarize the test",
    }));
  });

  it("always derives agent sessions from the pet interaction id", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "pets.utterance.route") {
        return {
          route: "agent",
          text: "Summarize the test",
          targetAgentId: "main",
          targetSessionKey: "agent:main:unrelated",
        };
      }
      if (method === "pets.activity.append") return { inserted: true };
      if (method === "sessions.create") return { ok: true, key: "agent:main:pets:task-2" };
      throw new Error(`unexpected ${method}`);
    });

    await submitUtterance(request, {
      text: "Summarize the test",
      interactionId: "task-2",
      asrProvider: "bailian-token-plan",
      requestedRoute: "agent",
    });

    expect(request).toHaveBeenNthCalledWith(3, "sessions.create", expect.objectContaining({
      key: "agent:main:pets:task-2",
    }));
  });

  it("does not store an ambiguous decision before the user chooses a final route", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "pets.utterance.route") return { route: "confirm", text: "Ambiguous request" };
      if (method === "pets.activity.append") return { inserted: true };
      throw new Error(`unexpected ${method}`);
    });

    const result = await submitUtterance(request, {
      text: "Ambiguous request",
      interactionId: "interaction-confirm-1",
      asrProvider: "webhook",
      now: () => "2026-08-16T12:00:00.000Z",
      createId: () => "unused",
    });

    expect(result).toEqual({
      kind: "confirm",
      text: "Ambiguous request",
      transcript: "Ambiguous request",
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it("stores exactly one original transcript after a confirmed route", async () => {
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "pets.utterance.route") {
        if (params?.requestedRoute !== "agent") {
          return { route: "confirm", text: "Summarize the test" };
        }
        return { route: "agent", text: "Summarize the test", targetAgentId: "main" };
      }
      if (method === "pets.activity.append") return { inserted: true };
      if (method === "sessions.create") return { ok: true, key: "agent:main:pets:task-confirmed" };
      throw new Error(`unexpected ${method}`);
    });

    const pending = await submitUtterance(request, {
      text: "ask: Summarize the test",
      interactionId: "task-confirmed",
      asrProvider: "bailian-token-plan",
    });
    expect(pending).toMatchObject({ kind: "confirm", text: "Summarize the test" });

    await submitUtterance(request, {
      text: "ask: Summarize the test",
      actionText: "Summarize the test",
      interactionId: "task-confirmed",
      asrProvider: "bailian-token-plan",
      requestedRoute: "agent",
      now: () => "2026-08-16T12:00:00.000Z",
      createId: () => "obs-confirmed",
    });

    expect(request.mock.calls.filter(([method]) => method === "pets.activity.append")).toEqual([["pets.activity.append", {
      observation: {
        id: "obs-confirmed",
        occurredAt: "2026-08-16T12:00:00.000Z",
        source: "voice",
        text: "ask: Summarize the test",
        asrProvider: "bailian-token-plan",
        route: "agent",
        interactionId: "task-confirmed",
      },
    }]]);
    expect(request).toHaveBeenLastCalledWith("sessions.create", expect.objectContaining({
      message: "Summarize the test",
    }));
  });
});
