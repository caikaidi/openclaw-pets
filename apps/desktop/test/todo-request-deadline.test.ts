import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayProtocolSocketHandlers } from "@openclaw/gateway-client/browser";
import { PETS_RPC } from "@openclaw-pets/protocol";
import { PetsGatewayClient } from "../src/runtime/gateway-client.js";

const clients: PetsGatewayClient[] = [];
afterEach(() => {
  clients.splice(0).forEach((client) => client.stop());
  vi.useRealTimers();
});

async function connectedClient(delayMs: number) {
  vi.useFakeTimers();
  let handlers!: GatewayProtocolSocketHandlers;
  let open = true;
  const sent: string[] = [];
  const summary = { status: "ok", todos: [], observationsRead: 1, gaps: [], generatedAt: "2026-09-09T04:25:00Z" };
  const client = new PetsGatewayClient({ url: "ws://127.0.0.1:18789/", appVersion: "0.5.3" }, {
    loadDeviceIdentity: async () => ({ deviceId: "a".repeat(64), publicKey: "public", sign: async () => "signature" }),
    readConnectionCredential: async () => null,
    createDeviceTokenStore: () => ({ load: async () => null, store: async () => undefined, clear: async () => undefined }),
    createSocket: (_url, callbacks) => {
      handlers = callbacks;
      return {
        isOpen: () => open,
        close: () => { open = false; },
        send: (raw) => {
          const frame = JSON.parse(raw) as { id: string; method: string };
          sent.push(frame.method);
          setTimeout(() => handlers.message(JSON.stringify({
            type: "res", id: frame.id, ok: true,
            payload: frame.method === "connect"
              ? { type: "hello-ok", protocol: 3, features: { methods: [], events: [] }, snapshot: {}, policy: {} }
              : summary,
          })), frame.method === "connect" ? 0 : delayMs);
        },
      };
    },
  });
  clients.push(client);
  await client.start();
  handlers.open();
  handlers.message(JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "test-nonce", ts: Date.now() } }));
  await vi.advanceTimersByTimeAsync(0);
  expect(client.connected).toBe(true);
  return { client, summary, sent };
}

describe("Todo deadline with the real Pets adapter and Gateway SDK (no network)", () => {
  it.each([34_887, 34_172, 210_000])("accepts the successful Todo response after %i ms without resending", async (delay) => {
    const { client, summary, sent } = await connectedClient(delay);
    const result = client.request(PETS_RPC.todoGenerate, { force: false }).then(
      (value) => ({ value }), (error: Error) => ({ error: error.message }),
    );
    await vi.advanceTimersByTimeAsync(delay);
    expect(await result).toEqual({ value: summary });
    expect(sent.filter((method) => method === PETS_RPC.todoGenerate)).toHaveLength(1);
  });

  it("keeps ordinary RPCs at 30 seconds", async () => {
    const { client } = await connectedClient(34_887);
    const result = client.request(PETS_RPC.status).catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toMatch(/timed out after 30000ms/);
  });

  it("honors an explicit Todo deadline", async () => {
    const { client } = await connectedClient(34_887);
    const result = client.request(PETS_RPC.todoGenerate, {}, { timeoutMs: 10 }).catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(10);
    expect(await result).toMatch(/timed out after 10ms/);
  });

  it("still terminates a stalled Todo request", async () => {
    const { client } = await connectedClient(300_000);
    const result = client.request(PETS_RPC.todoGenerate).catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(240_000);
    expect(await result).toMatch(/timed out after 240000ms/);
  });

  it("preserves caller cancellation without resending", async () => {
    const { client, sent } = await connectedClient(34_887);
    const controller = new AbortController();
    const result = client.request(PETS_RPC.todoGenerate, {}, { signal: controller.signal }).catch((error: Error) => error.message);
    controller.abort();
    expect(await result).toMatch(/aborted/);
    expect(sent.filter((method) => method === PETS_RPC.todoGenerate)).toHaveLength(1);
  });
});
