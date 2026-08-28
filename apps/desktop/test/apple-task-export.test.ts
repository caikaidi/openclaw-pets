import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addTodoToAppleCalendar,
  addTodoToAppleReminders,
  appleDateParts,
  suggestedCalendarWindow,
} from "../src/runtime/apple-task-export.js";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));

const todo = {
  id: "todo-1",
  title: "整理环境测试报告",
  notes: "发给张工",
  sourceObservationIds: ["journal-1"],
};

describe("Apple task export", () => {
  beforeEach(() => vi.mocked(invoke).mockClear());

  it("shows and uses the next work slot when the Journal has no explicit due time", async () => {
    const now = new Date(2026, 7, 28, 18, 20, 0);
    const window = suggestedCalendarWindow(todo, now);

    expect(window.inferred).toBe(true);
    expect(appleDateParts(window.start)).toEqual({ year: 2026, month: 8, day: 29, hour: 9, minute: 0 });
    await addTodoToAppleCalendar(todo, now);
    expect(invoke).toHaveBeenCalledWith("add_todo_to_apple_calendar", {
      input: expect.objectContaining({
        title: todo.title,
        start: { year: 2026, month: 8, day: 29, hour: 9, minute: 0 },
        end: { year: 2026, month: 8, day: 29, hour: 10, minute: 0 },
      }),
    });
  });

  it("preserves an explicit Journal due time for Calendar and Reminders", async () => {
    const scheduled = { ...todo, dueAt: "2026-08-30T07:30:00.000Z" };
    await addTodoToAppleCalendar(scheduled);
    await addTodoToAppleReminders(scheduled);

    const due = appleDateParts(new Date(scheduled.dueAt));
    expect(invoke).toHaveBeenNthCalledWith(1, "add_todo_to_apple_calendar", {
      input: expect.objectContaining({ start: due }),
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "add_todo_to_apple_reminders", {
      input: expect.objectContaining({ due }),
    });
  });
});
