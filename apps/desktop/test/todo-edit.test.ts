import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { addTodoToAppleCalendar, addTodoToAppleReminders } from "../src/runtime/apple-task-export.js";
import { reviseTodo } from "../src/runtime/todo-editor.js";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
const todo = { id: "one", title: "原题", notes: "原文", sourceObservationIds: ["journal-1"] };
describe("local Todo revision", () => {
  it("exports revised text through both existing Apple bridges, not the source text", async () => {
    const revised = reviseTodo(todo, "修订标题", "修订备注");
    await addTodoToAppleCalendar(revised); await addTodoToAppleReminders(revised);
    for (const method of ["add_todo_to_apple_calendar", "add_todo_to_apple_reminders"]) {
      expect(invoke).toHaveBeenCalledWith(method, { input: expect.objectContaining({ title: "修订标题", notes: expect.stringContaining("修订备注") }) });
    }
  });
  it("revises display/export text without changing provenance or the source object", () => {
    const revised = reviseTodo(todo, " 新题\n第二行 ", " 新备注 ");
    expect(revised).toEqual({ ...todo, title: "新题\n第二行", notes: "新备注" });
    expect(todo.title).toBe("原题");
  });
  it("rejects blank and oversized titles without losing the original", () => {
    expect(() => reviseTodo(todo, " \n ", "")).toThrow();
    expect(() => reviseTodo(todo, "x".repeat(301), "")).toThrow();
    expect(todo.title).toBe("原题");
  });
});
