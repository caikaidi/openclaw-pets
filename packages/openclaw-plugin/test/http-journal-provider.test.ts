import { describe, expect, it, vi } from "vitest";
import { HttpJournalProvider } from "../src/http-journal-provider.js";

describe("HttpJournalProvider", () => {
  it("uses the versioned Journal contract without creating a local copy", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      status: "ok",
      observations: [{
        id: "external-1",
        occurredAt: "2026-08-17T01:00:00.000Z",
        source: "external_voice",
        text: "External voice observation",
      }],
      gaps: [],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = new HttpJournalProvider({
      baseUrl: "https://journal.example.test",
      apiKey: "secret",
      timeoutMs: 4_000,
    }, fetcher);

    await expect(provider.page({
      limit: 30,
      startAt: "2026-08-16T16:00:00.000Z",
      endAt: "2026-08-17T16:00:00.000Z",
    })).resolves.toMatchObject({
      status: "ok",
      observations: [{ id: "external-1", source: "external_voice" }],
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://journal.example.test/v1/journal-provider/v1/page",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer secret" }),
      }),
    );
  });

  it("reports an explicit data gap when the remote Journal is unavailable", async () => {
    const provider = new HttpJournalProvider({
      baseUrl: "https://journal.example.test",
      apiKey: "secret",
      timeoutMs: 4_000,
    }, vi.fn<typeof fetch>().mockRejectedValue(new Error("network down")));

    await expect(provider.page({ limit: 30 })).resolves.toEqual({
      status: "unavailable",
      observations: [],
      gaps: [{ source: "journal", reason: "Remote Journal is unavailable" }],
    });
  });

  it("appends and retracts through the remote Provider without a local side effect", async () => {
    const observation = {
      id: "pets-1",
      occurredAt: "2026-08-17T01:00:00.000Z",
      source: "voice" as const,
      text: "桌宠流水",
      route: "context" as const,
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ inserted: true, observation }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ retracted: true }), { status: 200 }));
    const provider = new HttpJournalProvider({
      baseUrl: "https://journal.example.test",
      apiKey: "secret",
      timeoutMs: 4_000,
    }, fetcher);

    await expect(provider.append(observation)).resolves.toEqual({ inserted: true, observation });
    await expect(provider.retract(observation.id)).resolves.toBe(true);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://journal.example.test/v1/journal-provider/v1/append",
      "https://journal.example.test/v1/journal-provider/v1/retract",
    ]);
  });

  it("updates through the versioned remote contract and preserves conflicts", async () => {
    const updated = {
      id: "shared-remote",
      occurredAt: "2026-08-17T01:00:00.000Z",
      source: "external_voice",
      text: "远程修正",
      editedAt: "2026-08-17T02:00:00.000Z",
      revision: "revision-2",
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "updated", observation: updated }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "conflict", observation: updated }), { status: 200 }));
    const provider = new HttpJournalProvider({
      baseUrl: "https://journal.example.test",
      apiKey: "secret",
      timeoutMs: 4_000,
    }, fetcher);

    await expect(provider.update({
      id: "shared-remote",
      text: "远程修正",
      expectedRevision: "revision-1",
    })).resolves.toEqual({ status: "updated", observation: updated });
    await expect(provider.update({
      id: "shared-remote",
      text: "陈旧覆盖",
      expectedRevision: "revision-1",
    })).resolves.toEqual({ status: "conflict", observation: updated });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://journal.example.test/v1/journal-provider/v1/update",
      "https://journal.example.test/v1/journal-provider/v1/update",
    ]);
  });
});
