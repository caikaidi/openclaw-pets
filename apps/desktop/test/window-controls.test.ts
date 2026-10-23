import { afterEach, describe, expect, it, vi } from "vitest";
import { PetWindowController } from "../src/runtime/window-controller.js";

const native = vi.hoisted(() => ({
  focus: undefined as undefined | ((event: { payload: boolean }) => void),
  close: undefined as undefined | ((event: { preventDefault(): void }) => void),
}));
vi.mock("@tauri-apps/api/window", () => ({
  LogicalPosition: class {}, LogicalSize: class {}, currentMonitor: async () => null,
  getCurrentWindow: () => ({
    onFocusChanged: async (callback: typeof native.focus) => { native.focus = callback; return () => undefined; },
    onCloseRequested: async (callback: typeof native.close) => { native.close = callback; return () => undefined; },
    outerPosition: async () => ({ x: 0, y: 0 }), outerSize: async () => ({ width: 324, height: 237 }), scaleFactor: async () => 1,
    hide: async () => native.focus?.({ payload: false }), show: async () => native.focus?.({ payload: true }),
    setSize: async () => undefined, setPosition: async () => undefined,
  }),
}));
afterEach(() => vi.unstubAllGlobals());

describe("native menu lifecycle", () => {
  it("ignores blur from a layout's own hide/show but forwards external blur", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const controller = new PetWindowController(33, "status");
    const callback = vi.fn(); await controller.onFocusChanged(callback);
    await controller.apply(33, "panel");
    expect(callback).not.toHaveBeenCalled();
    native.focus?.({ payload: false });
    expect(callback).toHaveBeenCalledWith(false);
  });
  it("prevents window closure while recording controls need to remain reachable", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const controller = new PetWindowController(33, "status");
    let active = true;
    await controller.onCloseRequested(() => active);
    const preventDefault = vi.fn();
    native.close?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    active = false; native.close?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
  });
});
