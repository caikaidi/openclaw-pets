import { describe, expect, it } from "vitest";
import { PETS_PROTOCOL_VERSION } from "@openclaw-pets/protocol";
import { asrCapabilityLabel, isCompatibleCapabilities } from "../src/runtime/asr-status.js";

describe("ASR capability status", () => {
  it("shows the provider chain and its runtime health without exposing credentials", () => {
    expect(asrCapabilityLabel({ available: false, health: "unconfigured" })).toBe("未配置");
    expect(asrCapabilityLabel({
      available: true,
      health: "healthy",
      primary: "bailian-token-plan",
    })).toBe("bailian-token-plan（正常）");
    expect(asrCapabilityLabel({
      available: true,
      health: "degraded",
      primary: "bailian-token-plan",
      fallback: "dashscope",
    })).toBe("bailian-token-plan → dashscope（已切换备用）");
    expect(asrCapabilityLabel({
      available: true,
      health: "unavailable",
      primary: "webhook",
    })).toBe("webhook（不可用）");
  });

  it("rejects incompatible plugin protocol versions", () => {
    expect(isCompatibleCapabilities({ protocolVersion: PETS_PROTOCOL_VERSION })).toBe(true);
    expect(isCompatibleCapabilities({ protocolVersion: 1 })).toBe(false);
    expect(isCompatibleCapabilities({})).toBe(false);
  });
});
