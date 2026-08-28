import { describe, expect, it } from "vitest";
import {
  activityGapMessage,
  activitySourceLabel,
  recentTodoWindow,
  todayActivityWindow,
} from "../src/runtime/activity-journal.js";

describe("activity Journal UI", () => {
  it("requests the user's complete local calendar day as an ISO time window", () => {
    const window = todayActivityWindow(new Date(2026, 7, 17, 13, 30));
    expect(new Date(window.startAt).getHours()).toBe(0);
    expect(new Date(window.endAt).getHours()).toBe(0);
    expect(Date.parse(window.endAt) - Date.parse(window.startAt)).toBe(24 * 60 * 60 * 1_000);
  });

  it("summarizes a rolling thirty local-day Journal window for outstanding Todo", () => {
    const window = recentTodoWindow(new Date(2026, 7, 28, 13, 30));
    const start = new Date(window.startAt);
    const end = new Date(window.endAt);

    expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours()])
      .toEqual([2026, 6, 30, 0]);
    expect([end.getFullYear(), end.getMonth(), end.getDate(), end.getHours()])
      .toEqual([2026, 7, 29, 0]);
  });

  it("labels built-in and Provider-defined entries without channel knowledge", () => {
    expect(activitySourceLabel("external_voice")).toBe("External Voice");
    expect(activitySourceLabel("voice")).toBe("桌宠语音");
  });

  it("turns provider gaps into a visible warning instead of an empty-state claim", () => {
    expect(activityGapMessage({
      status: "unavailable",
      observations: [],
      gaps: [{ source: "journal", reason: "Remote Journal is unavailable" }],
    })).toContain("流水账暂时无法完整读取");
    expect(activityGapMessage({ observations: [] })).toBe("");
  });
});
