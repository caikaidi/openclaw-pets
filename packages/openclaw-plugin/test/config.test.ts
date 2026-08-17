import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config.js";

describe("OpenClaw Pets plugin config", () => {
  it("resolves a primary and optional fallback ASR provider without exposing them to the desktop", () => {
    const config = resolveConfig({
      asr: {
        maxAudioBytes: 4_000_000,
        maxDurationMs: 90_000,
        vocabulary: ["VBG", "PCSEL"],
        primary: {
          type: "bailian-token-plan",
          apiKey: "resolved-primary-key",
        },
        fallback: {
          type: "dashscope",
          apiKey: "resolved-fallback-key",
        },
      },
    });

    expect(config.asr).toMatchObject({
      maxAudioBytes: 4_000_000,
      maxDurationMs: 90_000,
      vocabulary: ["VBG", "PCSEL"],
      primary: {
        type: "bailian-token-plan",
        baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com",
        model: "qwen-audio-3.0-asr-flash",
      },
      fallback: {
        type: "dashscope",
        baseUrl: "https://dashscope.aliyuncs.com",
        model: "qwen-audio-3.0-asr-flash",
      },
    });
  });

  it("enables conservative classification for unmatched utterances", () => {
    const config = resolveConfig({ routing: { default: "agent" } });

    expect(config.routing).not.toHaveProperty("default");
    expect(config.routing.classifier).toEqual({ enabled: true, timeoutMs: 6_000 });
  });

  it("does not promote a fallback provider when no primary is configured", () => {
    const config = resolveConfig({
      asr: {
        fallback: { type: "dashscope", apiKey: "resolved-fallback-key" },
      },
    });

    expect(config.asr.primary).toBeUndefined();
    expect(config.asr.fallback).toBeUndefined();
  });

  it("uses local Journal by default and resolves an explicit HTTP Journal provider", () => {
    expect(resolveConfig({}).journal).toEqual({ provider: "local" });
    expect(resolveConfig({
      journal: {
        provider: "http",
        http: {
          baseUrl: "https://journal.example.test/",
          apiKey: "resolved-journal-key",
          timeoutMs: 4_000,
        },
      },
    }).journal).toEqual({
      provider: "http",
      http: {
        baseUrl: "https://journal.example.test",
        apiKey: "resolved-journal-key",
        timeoutMs: 4_000,
      },
    });
  });
});
