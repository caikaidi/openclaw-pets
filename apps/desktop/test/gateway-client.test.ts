import { describe, expect, it } from "vitest";
import {
  gatewayClientInfo,
  gatewayConnectionCredential,
  gatewayRequestedScopes,
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
});
