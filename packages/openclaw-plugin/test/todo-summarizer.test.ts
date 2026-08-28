import { describe, expect, it, vi } from "vitest";
import { createOpenClawTodoSummarizer } from "../src/todo-summarizer.js";

const observations = [{
  id: "journal-1",
  occurredAt: "2026-08-28T02:00:00.000Z",
  source: "voice",
  text: "周五下午三点前把环境测试报告发给张工",
}];

const secondObservation = {
  id: "journal-2",
  occurredAt: "2026-08-28T03:00:00.000Z",
  source: "text",
  text: "环境测试报告还需要发给张工",
};

describe("OpenClaw Journal todo summarizer", () => {
  it("uses only bounded Journal input and returns source-linked todos", async () => {
    const complete = vi.fn(async () => ({
      text: JSON.stringify({ todos: [{
        title: "发送环境测试报告",
        notes: "发给张工",
        dueAt: "2026-08-28T15:00:00+08:00",
        sourceObservationIds: ["journal-1"],
      }] }),
    }));
    const summarizer = createOpenClawTodoSummarizer(
      { llm: { complete } as never },
      { model: "example/model", timeoutMs: 8_000, maxItems: 12 },
    );

    await expect(summarizer.summarize({
      observations,
      now: "2026-08-28T03:00:00.000Z",
      timeZone: "Asia/Shanghai",
    })).resolves.toEqual([{
      id: "journal-todo-1-journal-1",
      title: "发送环境测试报告",
      notes: "发给张工",
      dueAt: "2026-08-28T07:00:00.000Z",
      sourceObservationIds: ["journal-1"],
    }]);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      model: "example/model",
      reasoning: "off",
      temperature: 0,
      purpose: "openclaw-pets.todo-summary",
      messages: [{ role: "user", content: expect.stringContaining("journal-1") }],
    }));
    expect(complete.mock.calls[0]?.[0]).not.toHaveProperty("tools");
    expect(complete.mock.calls[0]?.[0]).not.toHaveProperty("execution");
    expect(complete.mock.calls[0]?.[0]).not.toHaveProperty("agentId");
  });

  it("rejects model output that cites anything outside the Journal window", async () => {
    const complete = vi.fn(async () => ({
      text: JSON.stringify({ todos: [{
        title: "Unsupported task",
        notes: null,
        dueAt: null,
        sourceObservationIds: ["not-in-journal"],
      }] }),
    }));
    const summarizer = createOpenClawTodoSummarizer(
      { llm: { complete } as never },
      { timeoutMs: 8_000, maxItems: 12 },
    );

    await expect(summarizer.summarize({
      observations,
      now: "2026-08-28T03:00:00.000Z",
      timeZone: "Asia/Shanghai",
    })).resolves.toBeUndefined();
  });

  it("merges exact duplicate todos and preserves all Journal citations", async () => {
    const complete = vi.fn(async () => ({
      text: JSON.stringify({ todos: [{
        title: "发送环境测试报告",
        notes: "发给张工",
        dueAt: null,
        sourceObservationIds: ["journal-1"],
      }, {
        title: "发送环境测试报告",
        notes: "发给张工",
        dueAt: null,
        sourceObservationIds: ["journal-2"],
      }] }),
    }));
    const summarizer = createOpenClawTodoSummarizer(
      { llm: { complete } as never },
      { timeoutMs: 8_000, maxItems: 12 },
    );

    await expect(summarizer.summarize({
      observations: [...observations, secondObservation],
      now: "2026-08-28T03:00:00.000Z",
      timeZone: "Asia/Shanghai",
    })).resolves.toEqual([expect.objectContaining({
      title: "发送环境测试报告",
      sourceObservationIds: ["journal-1", "journal-2"],
    })]);
  });

  it("rejects calendar dates that JavaScript would silently normalize", async () => {
    const complete = vi.fn(async () => ({
      text: JSON.stringify({ todos: [{
        title: "发送环境测试报告",
        notes: null,
        dueAt: "2026-02-30T15:00:00+08:00",
        sourceObservationIds: ["journal-1"],
      }] }),
    }));
    const summarizer = createOpenClawTodoSummarizer(
      { llm: { complete } as never },
      { timeoutMs: 8_000, maxItems: 12 },
    );

    await expect(summarizer.summarize({
      observations,
      now: "2026-08-28T03:00:00.000Z",
      timeZone: "Asia/Shanghai",
    })).resolves.toBeUndefined();
  });
});
