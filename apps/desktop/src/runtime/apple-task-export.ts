import type { TodoItem } from "@openclaw-pets/protocol";
import { invoke } from "@tauri-apps/api/core";

export type AppleDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export type CalendarWindow = {
  start: Date;
  end: Date;
  inferred: boolean;
};

function validDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

export function suggestedCalendarWindow(todo: Pick<TodoItem, "dueAt">, now = new Date()): CalendarWindow {
  const explicit = validDate(todo.dueAt);
  const start = explicit ? new Date(explicit) : new Date(now);
  if (!explicit) {
    start.setSeconds(0, 0);
    if (start.getHours() < 8) {
      start.setHours(9, 0, 0, 0);
    } else {
      start.setHours(start.getHours() + 1, 0, 0, 0);
      if (start.getHours() >= 19) {
        start.setDate(start.getDate() + 1);
        start.setHours(9, 0, 0, 0);
      }
    }
  }
  return {
    start,
    end: new Date(start.getTime() + 60 * 60 * 1_000),
    inferred: !explicit,
  };
}

export function appleDateParts(date: Date): AppleDateParts {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
}

function todoNotes(todo: TodoItem): string {
  return [
    todo.notes,
    `由 OpenClaw Pets 从流水账总结 · 来源 ${todo.sourceObservationIds.length} 条`,
  ].filter(Boolean).join("\n\n");
}

export async function addTodoToAppleCalendar(todo: TodoItem, now = new Date()): Promise<CalendarWindow> {
  const window = suggestedCalendarWindow(todo, now);
  await invoke("add_todo_to_apple_calendar", {
    input: {
      title: todo.title,
      notes: todoNotes(todo),
      start: appleDateParts(window.start),
      end: appleDateParts(window.end),
    },
  });
  return window;
}

export async function addTodoToAppleReminders(todo: TodoItem): Promise<void> {
  const dueAt = validDate(todo.dueAt);
  await invoke("add_todo_to_apple_reminders", {
    input: {
      title: todo.title,
      notes: todoNotes(todo),
      ...(dueAt ? { due: appleDateParts(dueAt) } : {}),
    },
  });
}
