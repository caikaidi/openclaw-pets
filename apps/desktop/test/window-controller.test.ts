import { describe, expect, it, vi } from "vitest";
import { commitWindowTransition } from "../src/runtime/window-controller.js";
import type { PetWindowLayout } from "../src/runtime/window-layout.js";

describe("pet window transition", () => {
  it("keeps the native window hidden until the DOM layout has committed", async () => {
    const events: string[] = [];
    const layout: PetWindowLayout = {
      width: 424,
      height: 401,
      pet: { x: 47, y: 284, width: 202, height: 117 },
      overlay: { x: 32, y: 20, width: 360, height: 220 },
      overlayAnchorX: 116,
    };
    const appWindow = {
      hide: vi.fn(async () => { events.push("hide"); }),
      setSize: vi.fn(async () => { events.push("size"); }),
      setPosition: vi.fn(async () => { events.push("position"); }),
      show: vi.fn(async () => { events.push("show"); }),
    };

    await commitWindowTransition(appWindow, {
      x: 0,
      y: 399,
      width: 424,
      height: 401,
      layout,
    }, 1, async (committed) => {
      expect(committed).toBe(layout);
      events.push("dom");
    });

    expect(events).toEqual(["hide", "size", "position", "dom", "show"]);
  });

  it("shows the native window again when committing the DOM layout fails", async () => {
    const events: string[] = [];
    const appWindow = {
      hide: vi.fn(async () => { events.push("hide"); }),
      setSize: vi.fn(async () => { events.push("size"); }),
      setPosition: vi.fn(async () => { events.push("position"); }),
      show: vi.fn(async () => { events.push("show"); }),
    };
    const layout: PetWindowLayout = {
      width: 202,
      height: 117,
      pet: { x: 0, y: 0, width: 202, height: 117 },
      overlay: null,
      overlayAnchorX: null,
    };

    await expect(commitWindowTransition(appWindow, {
      x: 0,
      y: 683,
      width: 202,
      height: 117,
      layout,
    }, 1, async () => {
      events.push("dom");
      throw new Error("render failed");
    })).rejects.toThrow("render failed");

    expect(events.at(-1)).toBe("show");
  });
});
