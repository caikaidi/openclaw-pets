import { describe, expect, it, vi } from "vitest";
import { TodoRevisions } from "../src/runtime/todo-revisions.js";
import type { TodoItem } from "@openclaw-pets/protocol";

const todo: TodoItem = { id: "ordinal-1", title: "原始", notes: "说明", sourceObservationIds: ["b", "a"] };
function fixture() {
  const stored = new Map<string, string>();
  const native = vi.fn(async (command: string, args: Record<string, unknown>): Promise<unknown> => {
    if (command === "secure_get") return stored.get(String(args.key)) ?? null;
    if (command === "secure_set") { stored.set(String(args.key), String(args.value)); return; }
    throw new Error("unexpected command");
  });
  return { stored, native, open: (gateway = "ws://test.invalid") => new TodoRevisions(gateway, native) };
}
describe("bounded native Todo revision persistence", () => {
  it("survives restart, ordinal changes and source ordering without losing the current source IDs", async () => {
    const f = fixture(); const first = f.open(); await first.reconcile([todo], false, true);
    await first.save(todo, "修订", "");
    const moved = { ...todo, id: "ordinal-9", sourceObservationIds: ["a", "b"] };
    expect(await f.open().reconcile([moved], false, true)).toEqual([{ ...moved, title: "修订", notes: undefined }].map(({ notes: _notes, ...item }) => item));
    expect(await f.open("ws://other.invalid").reconcile([todo], false, true)).toEqual([todo]);
  });
  it.each(["title", "notes", "dueAt", "sourceObservationIds"])("does not attach revisions to changed %s, even if id is reused", async (field) => {
    const f = fixture(); const store = f.open(); await store.save(todo, "修订", "备注");
    const changed = { ...todo, [field]: field === "sourceObservationIds" ? ["other"] : "changed" };
    expect(await f.open().reconcile([changed], false, true)).toEqual([changed]);
    expect(await f.open().reconcile([todo], false, true)).toEqual([todo]);
  });
  it("does not treat a partial response as deletion; complete deletion removes the edit durably", async () => {
    const f = fixture(); await f.open().save(todo, "修订", "备注");
    await f.open().reconcile([], false, false);
    expect((await f.open().reconcile([todo], false, true))[0]?.title).toBe("修订");
    await f.open().reconcile([], false, true);
    expect(await f.open().reconcile([todo], false, true)).toEqual([todo]);
  });
  it("keeps export receipts across save, restart and explicit regeneration without exporting anything", async () => {
    const f = fixture(); const store = f.open(); await store.reconcile([todo], false, true);
    await store.markExported(todo, "calendar"); await store.markExported(todo, "reminders"); await store.save(todo, "修订", "备注");
    const reopened = f.open(); await reopened.reconcile([todo], true, true);
    expect(reopened.exported(todo, "calendar")).toBe(true); expect(reopened.exported(todo, "reminders")).toBe(true);
    expect(await f.open().reconcile([todo], false, true)).toEqual([todo]);
    expect(f.native.mock.calls.every(([cmd]) => ["secure_get", "secure_set"].includes(cmd))).toBe(true);
  });
  it("leaves the old durable revision intact when a write fails, and allows retry", async () => {
    const f = fixture(); const store = f.open(); await store.save(todo, "第一次", "备注");
    f.native.mockRejectedValueOnce(new Error("disk denied"));
    await expect(store.save(todo, "第二次", "备注")).rejects.toThrow("disk denied");
    expect((await f.open().reconcile([todo], false, true))[0]?.title).toBe("第一次");
    await store.save(todo, "第二次", "备注"); expect((await f.open().reconcile([todo], false, true))[0]?.title).toBe("第二次");
  });
  it("fails closed on malformed/oversized cache without overwriting it", async () => {
    const f = fixture(); f.stored.set("pets-todo-revisions-v1:ws://test.invalid", "broken");
    await expect(f.open().save(todo, "修订", "")).rejects.toThrow("未覆盖缓存");
    expect(f.native.mock.calls.some(([command]) => command === "secure_set")).toBe(false);
  });
  it("keeps an in-memory Apple receipt through refresh if the post-export write fails", async () => {
    const f = fixture(); const store = f.open(); await store.reconcile([todo], false, true);
    f.native.mockRejectedValueOnce(new Error("write denied"));
    await expect(store.markExported(todo, "calendar")).rejects.toThrow("Apple 项目已创建");
    await store.reconcile([todo], false, true); expect(store.exported(todo, "calendar")).toBe(true);
  });
  it("enforces UTF-8 byte capacity before native write; prior entries survive", async () => {
    const f = fixture(); const store = f.open();
    await store.save(todo, "修订", "字".repeat(8000));
    await store.save({ ...todo, id: "2", title: "第二条" }, "修订", "字".repeat(8000));
    await expect(store.save({ ...todo, id: "3", title: "第三条" }, "修订", "字".repeat(8000))).rejects.toThrow("已满");
    expect(f.native.mock.calls.filter(([command]) => command === "secure_set")).toHaveLength(2);
  });
});
