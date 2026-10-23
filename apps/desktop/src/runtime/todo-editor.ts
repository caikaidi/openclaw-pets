import type { TodoItem } from "@openclaw-pets/protocol";

/** A local revision, used by the same display and Apple export paths. */
export function reviseTodo(todo: TodoItem, title: string, notes: string): TodoItem {
  const normalized = title.trim();
  if (!normalized) throw new Error("Todo 标题不能为空");
  if (normalized.length > 300) throw new Error("Todo 标题不能超过 300 字");
  if (notes.trim().length > 8000) throw new Error("Todo 备注不能超过 8000 字");
  const revised = { ...todo, title: normalized };
  if (notes.trim()) revised.notes = notes.trim();
  else delete revised.notes;
  return revised;
}
