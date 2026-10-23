import { invoke } from "@tauri-apps/api/core";
import type { TodoItem } from "@openclaw-pets/protocol";
import { reviseTodo } from "./todo-editor.js";

type Entry = { source: string; title?: string; notes?: string; calendar?: boolean; reminders?: boolean };
type NativeInvoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;

/** Summary IDs contain an ordinal, so identity also uses the complete source
 * association and original content, independent of property/observation order. */
export function todoSource(todo: TodoItem): string {
  return JSON.stringify([ [...todo.sourceObservationIds].sort(), todo.title, todo.notes ?? "", todo.dueAt ?? "" ]);
}

/** One bounded vault entry per Gateway. No credentials, Journal, or Apple writes.
 * Native secure_set already validates and commits its vault transactionally. */
export class TodoRevisions {
  private entries: Entry[] = [];
  private sources = new Map<string, string>();
  private loaded = false;
  constructor(private gatewayUrl: string, private native: NativeInvoke = invoke) {}
  private key(): string { return `pets-todo-revisions-v1:${this.gatewayUrl}`; }

  private async load(): Promise<void> {
    if (this.loaded) return;
    const raw = await this.native("secure_get", { key: this.key() });
    if (raw !== null && raw !== undefined) {
      try {
        if (typeof raw !== "string" || new TextEncoder().encode(raw).length > 60_000) throw new Error();
        const parsed = JSON.parse(raw) as { version?: unknown; entries?: unknown };
        if (parsed.version !== 1 || !Array.isArray(parsed.entries) || parsed.entries.length > 100) throw new Error();
        const seen = new Set<string>();
        for (const value of parsed.entries) {
          if (!value || typeof value !== "object") throw new Error();
          const entry = value as Entry;
          if (typeof entry.source !== "string" || seen.has(entry.source)
            || (entry.title !== undefined && (typeof entry.title !== "string" || !entry.title.trim() || entry.title.length > 300))
            || (entry.notes !== undefined && (typeof entry.notes !== "string" || entry.notes.length > 8000))
            || (entry.calendar !== undefined && typeof entry.calendar !== "boolean")
            || (entry.reminders !== undefined && typeof entry.reminders !== "boolean")) throw new Error();
          seen.add(entry.source);
        }
        this.entries = parsed.entries as Entry[];
      } catch { throw new Error("本地 Todo 修订缓存损坏或版本不支持，未覆盖缓存"); }
    }
    this.loaded = true;
  }

  private async commit(entries: Entry[]): Promise<void> {
    const value = JSON.stringify({ version: 1, entries });
    if (entries.length > 100 || new TextEncoder().encode(value).length > 60_000) {
      throw new Error("本地 Todo 修订缓存已满，本次未保存");
    }
    await this.native("secure_set", { key: this.key(), value });
    this.entries = entries;
  }

  async reconcile(todos: TodoItem[], force: boolean, complete: boolean): Promise<TodoItem[]> {
    await this.load();
    const sources = new Map(todos.map((todo) => [todo.id, todoSource(todo)]));
    const current = new Set(sources.values());
    // Partial responses are data gaps, not evidence that sources were removed.
    // Export receipts survive regeneration; editing/reset never re-enables export.
    const entries = this.entries.flatMap((entry) => {
      if (force || (complete && !current.has(entry.source))) {
        return entry.calendar || entry.reminders
          ? [{ source: entry.source, ...(entry.calendar ? { calendar: true } : {}), ...(entry.reminders ? { reminders: true } : {}) }]
          : [];
      }
      return [entry];
    });
    if (JSON.stringify(entries) !== JSON.stringify(this.entries)) await this.commit(entries);
    this.sources = sources;
    return todos.map((todo) => {
      const entry = this.entries.find((item) => item.source === sources.get(todo.id));
      return entry?.title === undefined ? todo : reviseTodo(todo, entry.title, entry.notes ?? "");
    });
  }

  async save(todo: TodoItem, title: string, notes: string): Promise<TodoItem> {
    const revised = reviseTodo(todo, title, notes);
    await this.load();
    const source = this.sources.get(todo.id) ?? todoSource(todo);
    const previous = this.entries.find((entry) => entry.source === source);
    await this.commit([...this.entries.filter((entry) => entry.source !== source), {
      ...previous, source, title: revised.title, notes: revised.notes ?? "",
    }]);
    this.sources.set(todo.id, source);
    return revised;
  }

  exported(todo: TodoItem, target: "calendar" | "reminders"): boolean {
    return this.entries.some((entry) => entry.source === (this.sources.get(todo.id) ?? todoSource(todo)) && entry[target]);
  }

  async markExported(todo: TodoItem, target: "calendar" | "reminders"): Promise<void> {
    await this.load();
    const source = this.sources.get(todo.id) ?? todoSource(todo);
    const previous = this.entries.find((entry) => entry.source === source);
    const entries = [...this.entries.filter((entry) => entry.source !== source), { ...previous, source, [target]: true }];
    try { await this.commit(entries); }
    catch {
      // Apple has already succeeded. Retain the in-process receipt even when
      // disk persistence fails so passive refresh cannot enable a duplicate.
      this.entries = entries;
      throw new Error("Apple 项目已创建，但本地导出标记保存失败；重开后请先检查 Apple，勿重复导出");
    }
  }
}
