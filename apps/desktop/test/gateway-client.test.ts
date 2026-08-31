import { describe, expect, it } from "vitest";
import {
  gatewayClientInfo,
  gatewayConnectionCredential,
  gatewayRequestedScopes,
  PetsGatewayClient,
  validateGatewayWebSocketUrl,
} from "../src/runtime/gateway-client.js";

describe("OpenClaw Pets Gateway identity", () => {
  it("uses a generic third-party UI identity and treats onboarding input as shared auth", () => {
    expect(gatewayClientInfo("0.1.0", "macos 26.0")).toMatchObject({
      id: "gateway-client",
      mode: "ui",
      platform: "macos 26.0",
      deviceFamily: "desktop",
    });
    expect(gatewayConnectionCredential("gateway-secret")).toEqual({ token: "gateway-secret" });
    expect(gatewayConnectionCredential(undefined)).toEqual({});
    expect(gatewayRequestedScopes).toEqual(["operator.read", "operator.write"]);
  });

  it("accepts a secure remote Gateway and limits plaintext WebSockets to loopback", () => {
    expect(validateGatewayWebSocketUrl("wss://gateway.example.com")).toBe("wss://gateway.example.com/");
    expect(validateGatewayWebSocketUrl("ws://127.0.0.1:18789")).toBe("ws://127.0.0.1:18789/");
    expect(validateGatewayWebSocketUrl("ws://localhost:18789")).toBe("ws://localhost:18789/");
    expect(() => validateGatewayWebSocketUrl("ws://192.0.2.10:18789")).toThrow(/wss:\/\//u);
    expect(() => validateGatewayWebSocketUrl("https://gateway.example.com")).toThrow(/WebSocket/u);
    expect(() => validateGatewayWebSocketUrl("wss://user:password@gateway.example.com")).toThrow(/credentials/u);
  });

  it("does not open a WebSocket until secure storage preflight has completed", async () => {
    let resolveIdentity: ((value: { deviceId: string; publicKey: string; sign: () => Promise<string> }) => void) | undefined;
    const identity = new Promise<{ deviceId: string; publicKey: string; sign: () => Promise<string> }>((resolve) => {
      resolveIdentity = resolve;
    });
    let socketCreations = 0;
    const tokenStore = {
      load: async () => null,
      store: async () => undefined,
      clear: async () => undefined,
    };
    const states: string[] = [];
    const client = new PetsGatewayClient({
      url: "ws://127.0.0.1:18789/",
      appVersion: "0.5.2",
      onStateChange: (state) => states.push(state),
    }, {
      loadDeviceIdentity: async () => identity,
      readConnectionCredential: async () => null,
      createDeviceTokenStore: () => tokenStore,
      createSocket: () => {
        socketCreations += 1;
        return { isOpen: () => false, send: () => undefined, close: () => undefined };
      },
    });

    const started = client.start();
    await Promise.resolve();
    expect(socketCreations).toBe(0);

    resolveIdentity?.({
      deviceId: "a".repeat(64),
      publicKey: "public",
      sign: async () => "signature",
    });
    await started;

    expect(socketCreations).toBe(1);
    expect(states).toEqual(["connecting"]);
    client.stop();
  });

  it("stops before opening a WebSocket when secure storage authorization is denied", async () => {
    let socketCreations = 0;
    const states: Array<[string, string | undefined]> = [];
    const client = new PetsGatewayClient({
      url: "ws://127.0.0.1:18789/",
      appVersion: "0.5.2",
      onStateChange: (state, detail) => states.push([state, detail]),
    }, {
      loadDeviceIdentity: async () => { throw new Error("secure storage authorization required"); },
      readConnectionCredential: async () => null,
      createDeviceTokenStore: () => ({
        load: async () => null,
        store: async () => undefined,
        clear: async () => undefined,
      }),
      createSocket: () => {
        socketCreations += 1;
        return { isOpen: () => false, send: () => undefined, close: () => undefined };
      },
    });

    await client.start();

    expect(socketCreations).toBe(0);
    expect(states.at(-1)).toEqual(["error", "secure storage authorization required"]);
  });

  it("does not open a WebSocket when stopped during secure storage preflight", async () => {
    let resolveIdentity: ((value: { deviceId: string; publicKey: string; sign: () => Promise<string> }) => void) | undefined;
    const identity = new Promise<{ deviceId: string; publicKey: string; sign: () => Promise<string> }>((resolve) => {
      resolveIdentity = resolve;
    });
    let socketCreations = 0;
    const states: string[] = [];
    const client = new PetsGatewayClient({
      url: "ws://127.0.0.1:18789/",
      appVersion: "0.5.2",
      onStateChange: (state) => states.push(state),
    }, {
      loadDeviceIdentity: async () => identity,
      readConnectionCredential: async () => null,
      createDeviceTokenStore: () => ({
        load: async () => null,
        store: async () => undefined,
        clear: async () => undefined,
      }),
      createSocket: () => {
        socketCreations += 1;
        return { isOpen: () => false, send: () => undefined, close: () => undefined };
      },
    });

    const started = client.start();
    await Promise.resolve();
    client.stop();
    resolveIdentity?.({
      deviceId: "a".repeat(64),
      publicKey: "public",
      sign: async () => "signature",
    });
    await started;

    expect(socketCreations).toBe(0);
    expect(states.at(-1)).toBe("disconnected");
  });
});
