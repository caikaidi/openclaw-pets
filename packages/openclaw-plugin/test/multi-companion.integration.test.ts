import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PETS_RPC, type PetStatus } from "@openclaw-pets/protocol";
import { describe, expect, it } from "vitest";
import {
  createApi,
  deliverAgentEvent,
  request,
  type GatewayHandler,
} from "./helpers/plugin-harness.js";

class CompanionClient {
  readonly statuses: PetStatus[] = [];

  constructor(
    private readonly methods: Map<string, GatewayHandler>,
    readonly deviceId: string,
    readonly interactionId: string,
  ) {}

  request(method: string, params: Record<string, unknown> = {}) {
    return request(this.methods, method, params);
  }

  acceptGatewayEvent(payload: Record<string, unknown>): void {
    if (payload.interactionId === this.interactionId) this.statuses.push(payload as PetStatus);
  }
}

describe("two companion clients on one Gateway", () => {
  it("shares Journal RPCs while filtering broadcast state by independently paired device", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openclaw-pets-two-devices-"));
    const harness = createApi(directory);
    const uuid = "11111111-2222-4333-8444-555555555555";
    const firstDevice = "a".repeat(64);
    const secondDevice = "b".repeat(64);
    const first = new CompanionClient(harness.methods, firstDevice, `${firstDevice}.${uuid}`);
    const second = new CompanionClient(harness.methods, secondDevice, `${secondDevice}.${uuid}`);
    const clients = [first, second];

    await harness.service?.start({
      gatewayEvents: {
        emit(_event, payload) {
          for (const client of clients) client.acceptGatewayEvent(payload as Record<string, unknown>);
        },
      },
    });

    await Promise.all([
      first.request(PETS_RPC.activityAppend, { observation: {
        id: "first-device-journal",
        occurredAt: "2026-08-17T12:00:00.000Z",
        source: "desktop_voice",
        text: "First device observation",
        interactionId: first.interactionId,
      } }),
      second.request(PETS_RPC.activityAppend, { observation: {
        id: "second-device-journal",
        occurredAt: "2026-08-17T12:00:01.000Z",
        source: "desktop_voice",
        text: "Second device observation",
        interactionId: second.interactionId,
      } }),
    ]);
    await deliverAgentEvent(harness.agentEventSubscription, {
      runId: "first-run",
      seq: 1,
      stream: "lifecycle",
      ts: Date.now(),
      data: { phase: "start" },
      sessionKey: `agent:main:pets:${first.interactionId}`,
    });
    await deliverAgentEvent(harness.agentEventSubscription, {
      runId: "second-run",
      seq: 1,
      stream: "lifecycle",
      ts: Date.now(),
      data: { phase: "start" },
      sessionKey: `agent:main:pets:${second.interactionId}`,
    });
    await deliverAgentEvent(harness.agentEventSubscription, {
      runId: "first-run",
      seq: 2,
      stream: "tool",
      ts: Date.now(),
      data: { phase: "start", toolCallId: "tool-a", name: "browser" },
      sessionKey: `agent:main:pets:${first.interactionId}`,
    });

    const firstJournal = await first.request(PETS_RPC.activityList, { limit: 10 });
    const secondJournal = await second.request(PETS_RPC.activityList, { limit: 10 });
    expect(firstJournal).toEqual(secondJournal);
    expect(firstJournal).toMatchObject({
      ok: true,
      payload: {
        observations: [
          { id: "second-device-journal" },
          { id: "first-device-journal" },
        ],
      },
    });
    expect(await first.request(PETS_RPC.status, { interactionId: first.interactionId }))
      .toMatchObject({ ok: true, payload: { interactionId: first.interactionId, state: "working" } });
    expect(await second.request(PETS_RPC.status, { interactionId: second.interactionId }))
      .toMatchObject({ ok: true, payload: { interactionId: second.interactionId, state: "thinking" } });
    expect(first.statuses).toEqual([
      expect.objectContaining({ interactionId: first.interactionId, state: "thinking" }),
      expect.objectContaining({ interactionId: first.interactionId, state: "working" }),
    ]);
    expect(second.statuses).toEqual([
      expect.objectContaining({ interactionId: second.interactionId, state: "thinking" }),
    ]);
    expect(first.statuses).not.toContainEqual(expect.objectContaining({ interactionId: second.interactionId }));
    expect(second.statuses).not.toContainEqual(expect.objectContaining({ interactionId: first.interactionId }));

    await harness.service?.stop();
  });
});
