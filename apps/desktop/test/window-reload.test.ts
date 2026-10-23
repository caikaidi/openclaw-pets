import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PetWindowController } from "../src/runtime/window-controller.js";
import { layoutFor, type PetOverlay, type PetScale } from "../src/runtime/window-layout.js";

const native = vi.hoisted(() => ({
  x: 600, y: 0, width: 0, height: 0, factor: 2,
  monitor: { position: { x: 0, y: 0 }, size: { width: 3024, height: 1964 } } as
    { position: { x: number; y: number }; size: { width: number; height: number } } | null,
}));

vi.mock("@tauri-apps/api/window", () => ({
  LogicalSize: class { constructor(public width: number, public height: number) {} },
  LogicalPosition: class { constructor(public x: number, public y: number) {} },
  currentMonitor: async () => native.monitor,
  getCurrentWindow: () => ({
    outerPosition: async () => ({ x: native.x, y: native.y }),
    outerSize: async () => ({ width: native.width, height: native.height }),
    scaleFactor: async () => native.factor,
    hide: async () => undefined,
    show: async () => undefined,
    setSize: async (size: { width: number; height: number }) => {
      native.width = size.width * native.factor;
      native.height = size.height * native.factor;
    },
    setPosition: async (position: { x: number; y: number }) => {
      native.x = position.x * native.factor;
      native.y = position.y * native.factor;
    },
  }),
}));

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  native.factor = 2;
  native.x = 600;
  native.monitor = { position: { x: 0, y: 0 }, size: { width: 3024, height: 1964 } };
});

function retainWindow(scale: PetScale, overlay: PetOverlay, bottom = 1964): void {
  const layout = layoutFor(scale, overlay);
  native.width = layout.width * native.factor;
  native.height = layout.height * native.factor;
  native.y = bottom - native.height;
}

describe("native window retained across frontend reload", () => {
  it("does not walk an idle pet below the bottom edge after repeated reloads", async () => {
    retainWindow(33, "none");
    const bottoms: number[] = [];

    for (let reload = 0; reload < 3; reload++) {
      // App.vue reconstructs this controller, mounts offline/status, then
      // switches to none after Gateway reconnects to idle. Native bounds survive.
      const controller = new PetWindowController(33, "status");
      await controller.apply(33, "status");
      expect(native.y + native.height).toBe(1964);
      await controller.apply(33, "none");
      bottoms.push(native.y + native.height);
    }

    expect(bottoms).toEqual([1964, 1964, 1964]);
  });

  it.each([
    [1, 1964, true],
    [2, 1000, true],
    [2, 1000, false],
  ] as const)("preserves the retained bottom with factor=%s bottom=%s monitor=%s", async (factor, bottom, monitor) => {
    native.factor = factor;
    if (!monitor) native.monitor = null;
    retainWindow(33, "none", bottom);
    const controller = new PetWindowController(33, "status");
    await controller.apply(33, "status");
    await controller.apply(33, "none");
    expect(native.y + native.height).toBe(bottom);
  });

  it("does not drift when the controller's initial layout matches the retained window", async () => {
    retainWindow(33, "none");
    const controller = new PetWindowController(33, "none");
    for (let cycle = 0; cycle < 3; cycle++) {
      await controller.apply(33, "status");
      await controller.apply(33, "none");
    }
    expect(native.y + native.height).toBe(1964);
  });

  describe.each([1, 2])("at display scale factor %s", (factor) => {
    it.each(([33, 50, 75] as const).flatMap((scale) =>
      (["none", "status", "decision", "panel"] as const).map((overlay) => ({ scale, overlay })),
    ))("restores $scale% from $overlay without shifting the bottom", async ({ scale, overlay }) => {
      native.factor = factor;
      retainWindow(scale, overlay);
      const controller = new PetWindowController(33, "status");
      for (const nextOverlay of ["status", "none", "panel", "none"] as const) {
        await controller.apply(scale, nextOverlay);
        expect(native.y + native.height).toBe(1964);
      }
    });
  });

  it("anchors a fresh launch before restoring a larger saved pet scale", async () => {
    retainWindow(33, "status", 1200);
    const controller = new PetWindowController(33, "status");
    await controller.apply(75, "status");
    await controller.apply(75, "none");
    expect(native.y + native.height).toBe(1200);
  });

  it("serializes mount and watcher transitions on a monitor with a negative origin", async () => {
    native.monitor = { position: { x: -3024, y: -1964 }, size: { width: 3024, height: 1964 } };
    native.x = -2000;
    retainWindow(33, "none", 0);
    const controller = new PetWindowController(33, "status");
    await Promise.all([
      controller.apply(33, "status"),
      controller.apply(33, "none"),
      controller.apply(50, "panel"),
      controller.apply(50, "none"),
    ]);
    expect(native.y + native.height).toBe(0);
  });
});
