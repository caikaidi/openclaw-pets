import { describe, expect, it, vi } from "vitest";
import { createOpenClawUtteranceClassifier } from "../src/utterance-classifier.js";

describe("OpenClaw utterance classifier", () => {
  it("uses a bounded zero-tool completion and accepts only the two routing outcomes", async () => {
    const complete = vi.fn(async () => ({ text: '{"decision":"task_candidate"}' }));
    const classifier = createOpenClawUtteranceClassifier(
      { llm: { complete } as never },
      { agentId: "main", model: "example/lightweight", timeoutMs: 2_000 },
    );

    await expect(classifier.classify("请整理今天的试验数据")).resolves.toBe("task_candidate");
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      model: "example/lightweight",
      maxTokens: 24,
      temperature: 0,
      reasoning: "off",
      purpose: "openclaw-pets.utterance-route",
      agentId: "main",
      execution: { mode: "isolated-agent-runtime", timeoutMs: 2_000 },
      messages: [{ role: "user", content: expect.stringContaining("<transcript>") }],
    }));
    expect(complete.mock.calls[0]?.[0]).not.toHaveProperty("tools");
  });

  it("treats malformed or expanded model output as uncertain", async () => {
    const outputs = [
      "task_candidate",
      '{"decision":"execute"}',
      '{"decision":"record_only","comment":"extra"}',
    ];
    const complete = vi.fn(async () => ({ text: outputs.shift()! }));
    const classifier = createOpenClawUtteranceClassifier(
      { llm: { complete } as never },
      { timeoutMs: 2_000 },
    );

    await expect(classifier.classify("one")).resolves.toBeUndefined();
    await expect(classifier.classify("two")).resolves.toBeUndefined();
    await expect(classifier.classify("three")).resolves.toBeUndefined();
  });
});
