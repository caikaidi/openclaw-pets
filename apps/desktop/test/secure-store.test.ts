import { describe, expect, it, vi } from "vitest";
import { createSecureStoreRuntime } from "../src/runtime/secure-store.js";

describe("desktop secure-store runtime", () => {
  it("caches device identity and device tokens for the lifetime of the process", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "device_identity") {
        return { deviceId: "a".repeat(64), publicKey: "public" };
      }
      if (command === "sign_device_payload") return "signature";
      if (command === "secure_get") {
        return JSON.stringify({ token: "issued", scopes: ["operator.read", "operator.write"] });
      }
      return undefined;
    });
    const runtime = createSecureStoreRuntime(invoke);

    const firstIdentity = await runtime.loadDeviceIdentity();
    const secondIdentity = await runtime.loadDeviceIdentity();
    const store = runtime.createDeviceTokenStore("ws://127.0.0.1:18789/");
    const params = {
      clientId: "gateway-client",
      deviceId: firstIdentity.deviceId,
      role: "operator",
    };

    expect(secondIdentity).toBe(firstIdentity);
    expect(await store.load(params)).toEqual({
      token: "issued",
      scopes: ["operator.read", "operator.write"],
    });
    expect(await store.load(params)).toEqual({
      token: "issued",
      scopes: ["operator.read", "operator.write"],
    });
    await store.store({ ...params, token: "issued", scopes: ["operator.read", "operator.write"] });

    expect(invoke.mock.calls.filter(([command]) => command === "device_identity")).toHaveLength(1);
    expect(invoke.mock.calls.filter(([command]) => command === "secure_get")).toHaveLength(1);
    expect(invoke.mock.calls.filter(([command]) => command === "secure_set")).toHaveLength(0);
  });

  it("caches an absent connection credential instead of probing Keychain on every reconnect", async () => {
    const invoke = vi.fn(async (command: string) => command === "secure_get" ? null : undefined);
    const runtime = createSecureStoreRuntime(invoke);

    expect(await runtime.readConnectionCredential("ws://127.0.0.1:18789/")).toBeNull();
    expect(await runtime.readConnectionCredential("ws://127.0.0.1:18789/")).toBeNull();

    expect(invoke.mock.calls.filter(([command]) => command === "secure_get")).toHaveLength(1);
  });
});
