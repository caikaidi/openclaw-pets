import { describe, expect, it, vi } from "vitest";
import { observePetFocus, AnimationClock } from "../src/runtime/pet-focus.js";

describe("visual focus lifecycle", () => {
  it("freezes elapsed time and resumes without jumping over the blur interval", () => {
    const clock = new AnimationClock();
    expect(clock.tick(100)).toBe(0); expect(clock.tick(180)).toBe(80);
    clock.pause(); expect(clock.tick(5000)).toBe(80);
    clock.resume(); expect(clock.tick(5100)).toBe(80); expect(clock.tick(5140)).toBe(120);
  });
  it("reconciles initial/native/DOM focus and removes both subscriptions", async () => {
    const dom = new EventTarget(); let native!: (value: boolean) => void;
    const unlisten = vi.fn(); const change = vi.fn();
    const stop = observePetFocus({ dom, initial: () => false, query: async () => false,
      subscribe: async (cb) => { native = cb; return unlisten; }, transitioning: () => false }, change);
    await Promise.resolve(); await Promise.resolve();
    expect(change).toHaveBeenLastCalledWith(false);
    native(true); expect(change).toHaveBeenLastCalledWith(true);
    dom.dispatchEvent(new Event("blur")); expect(change).toHaveBeenLastCalledWith(false);
    stop(); const count = change.mock.calls.length;
    native(true); dom.dispatchEvent(new Event("focus"));
    expect(change).toHaveBeenCalledTimes(count); expect(unlisten).toHaveBeenCalledOnce();
  });
  it("ignores hide/show focus during menu layout and cleans a late subscription", async () => {
    const dom = new EventTarget(); const change = vi.fn(); const unlisten = vi.fn();
    let resolve!: (stop: () => void) => void;
    const stop = observePetFocus({ dom, initial: () => true, query: async () => true,
      subscribe: () => new Promise((r) => { resolve = r; }), transitioning: () => true }, change);
    dom.dispatchEvent(new Event("blur")); expect(change).toHaveBeenLastCalledWith(true);
    stop(); resolve(unlisten); await Promise.resolve(); expect(unlisten).toHaveBeenCalledOnce();
  });
  it("does not let a stale initial query overwrite a newer focus event", async () => {
    let resolve!: (value: boolean) => void; const dom = new EventTarget(); const change = vi.fn();
    const stop = observePetFocus({ dom, initial: () => false, query: () => new Promise((r) => { resolve = r; }),
      subscribe: async () => () => undefined, transitioning: () => false }, change);
    dom.dispatchEvent(new Event("focus")); resolve(false); await Promise.resolve();
    expect(change).toHaveBeenLastCalledWith(true); stop();
  });
});
