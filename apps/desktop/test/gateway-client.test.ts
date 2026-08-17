import { describe, expect, it } from "vitest";
import {
  gatewayClientInfo,
  gatewayConnectionCredential,
  gatewayRequestedScopes,
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
});
