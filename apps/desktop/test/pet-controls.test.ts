import { afterEach, describe, expect, it, vi } from "vitest";
import type { Ref } from "vue";
import type * as Vue from "vue";
import { readFileSync } from "node:fs";
import { PETS_RPC, PETS_PROTOCOL_VERSION } from "@openclaw-pets/protocol";
import { layoutFor } from "../src/runtime/window-layout.js";

const platform = vi.hoisted(() => ({
  mounted: [] as (() => void)[], request: vi.fn(), drag: vi.fn(),
  state: undefined as undefined | ((value: string) => void),
  focus: undefined as undefined | ((focused: boolean) => void),
  track: { readyState: "live", stop: vi.fn() },
  port: undefined as undefined | { state: string; onData(blob: Blob): void; onStop(): void; onError(error: Error): void },
}));
vi.mock("vue", async (load) => ({ ...await load<typeof Vue>(),
  onMounted: (callback: () => void) => platform.mounted.push(callback),
  onBeforeUnmount: vi.fn(), useSSRContext: () => ({ modules: new Set() }), watch: vi.fn(),
}));
vi.mock("../src/runtime/gateway-client.js", () => ({
  validateGatewayWebSocketUrl: (url: string) => url,
  PetsGatewayClient: class {
    connected = true; request = platform.request;
    constructor(private options: { onStateChange: (state: string) => void; onHello: () => void }) { platform.state = options.onStateChange; }
    start() { this.options.onStateChange("connected"); this.options.onHello(); }
    stop() {}
  },
}));
vi.mock("../src/runtime/window-controller.js", () => ({ PetWindowController: class {
  async apply() {} startDragging = platform.drag;
  async onFocusChanged(callback: (focused: boolean) => void) { platform.focus = callback; return () => undefined; }
  async onCloseRequested() { return () => undefined; }
} }));
vi.mock("../src/runtime/pet-pack-loader.js", () => ({ loadActivePetPack: async () => undefined }));
vi.mock("../src/runtime/pet-pack-manager.js", () => ({ PetPackManager: class { async list() { return []; } } }));
vi.mock("../src/runtime/interaction-id.js", () => ({ createDeviceInteractionId: async () => "controls-test" }));
vi.mock("../src/runtime/batch-recorder.js", async (load) => {
  const actual = await load<typeof import("../src/runtime/batch-recorder.js")>();
  return { ...actual, BatchRecorder: class extends actual.BatchRecorder {
    constructor() { super({
      getUserMedia: async () => ({ getTracks: () => [platform.track] }) as unknown as MediaStream,
      createRecorder: () => {
        const port = { mimeType: "audio/webm", state: "inactive" as "inactive" | "recording", onData(_blob: Blob) {}, onStop() {}, onError(_error: Error) {},
          start() { this.state = "recording"; }, stop() { this.state = "inactive"; },
        };
        platform.port = port; return port;
      },
    }); }
  } };
});
import App from "../src/App.vue";
type State = {
  panel: Ref<string | undefined>; petPressed: Ref<boolean>; recordingLabel: Ref<string>;
  renderedLayout: Ref<ReturnType<typeof layoutFor>>; rootStyle: Ref<Record<string, string>>;
  toggleRecording(): Promise<void>; closePanel(): void; onWindowBlur(): void;
  onOutsidePointerDown(event: { composedPath(): unknown[] }): void;
  onPetPointerDown(event: PointerEvent): void; onPetPointerMove(event: PointerEvent): void;
  onPetPointerUp(): void; onPetPointerCancel(): void;
  currentInteractionId: Ref<string | undefined>; refreshStatus(): Promise<void>;
};
async function setup(): Promise<State> {
  vi.useFakeTimers(); vi.stubGlobal("window", { ...globalThis, setTimeout, clearTimeout, setInterval, clearInterval, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("localStorage", { getItem: (key: string) => key.endsWith("connection-configured") ? "true" : null, setItem: vi.fn(), removeItem: vi.fn() });
  platform.drag.mockResolvedValue(undefined);
  platform.track.readyState = "live";
  platform.track.stop.mockImplementation(() => { platform.track.readyState = "ended"; });
  platform.request.mockImplementation(async (method: string) => {
    if (method === PETS_RPC.status) return { state: "idle" };
    if (method === PETS_RPC.capabilities) return { protocolVersion: PETS_PROTOCOL_VERSION, features: { batchTranscription: { available: true, health: "healthy" } } };
    if (method === PETS_RPC.transcriptionCreate) return new Promise(() => undefined);
    return { observations: [], gaps: [] };
  });
  const app = (App.setup as unknown as (p: object, c: object) => State)({}, { expose() {} });
  platform.mounted.forEach((mount) => mount());
  await Promise.resolve(); await Promise.resolve();
  return app;
}
const down = { button: 0, buttons: 1, screenX: 20, screenY: 20 } as PointerEvent;
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); platform.mounted.length = 0; platform.request.mockReset(); platform.drag.mockReset(); platform.track.stop.mockReset(); });

describe("real App recording and menu handlers", () => {
  it("keeps the capture interaction when a reconnect status reports idle", async () => {
    const app = await setup(); await app.toggleRecording();
    await app.refreshStatus();
    expect(app.currentInteractionId.value).toBe("controls-test");
  });
  it("keeps recording when menu closes, and can stop while disconnected", async () => {
    const app = await setup(); await app.toggleRecording();
    app.panel.value = "activity"; app.closePanel();
    expect(platform.track.stop).not.toHaveBeenCalled();
    platform.state?.("disconnected");
    const stopping = app.toggleRecording();
    expect(platform.port?.state).toBe("inactive");
    expect(app.recordingLabel.value).toContain("停止中");
    platform.port?.onData(new Blob(["audio"])); platform.port?.onStop();
    await stopping;
    expect(platform.track.stop).toHaveBeenCalledOnce();
    expect(app.recordingLabel.value).not.toContain("采音中");
  });
  it("distinguishes capture, pending release and ASR", async () => {
    const app = await setup(); await app.toggleRecording();
    expect(app.recordingLabel.value).toContain("采音中");
    void app.toggleRecording();
    expect(app.recordingLabel.value).toContain("停止中");
    platform.port?.onData(new Blob(["audio"])); platform.port?.onStop();
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(app.recordingLabel.value).toContain("转写");
    expect(app.recordingLabel.value).toContain("已释放");
  });
  it("closes on transparent outside presses and blur without stopping capture", async () => {
    const app = await setup(); await app.toggleRecording();
    app.panel.value = "activity";
    app.onOutsidePointerDown({ composedPath: () => [] });
    expect(app.panel.value).toBeUndefined();
    app.panel.value = "activity"; app.onWindowBlur();
    expect(app.panel.value).toBeUndefined();
    expect(platform.track.stop).not.toHaveBeenCalled();
  });
  it("leaves an inside menu press open", async () => {
    const app = await setup(); app.panel.value = "activity";
    app.onOutsidePointerDown({ composedPath: () => [{ classList: { contains: (name: string) => name === "floating-panel" } }] });
    expect(app.panel.value).toBe("activity");
  });
  it("consumes a pet click used to dismiss the menu without stopping capture", async () => {
    const app = await setup(); await app.toggleRecording(); app.panel.value = "activity";
    const event = { ...down, composedPath: () => [] } as PointerEvent;
    app.onOutsidePointerDown(event); app.onPetPointerDown(event); app.onPetPointerUp();
    expect(app.panel.value).toBeUndefined();
    expect(platform.port?.state).toBe("recording");
  });
  it.each(["cancel", "blur", "drag", "up", "released-buttons"])("restores the visual press on %s", async (end) => {
    const app = await setup(); app.onPetPointerDown(down);
    expect(app.petPressed.value).toBe(true);
    if (end === "cancel") app.onPetPointerCancel();
    if (end === "blur") app.onWindowBlur();
    if (end === "drag") app.onPetPointerMove({ ...down, screenX: 40 } as PointerEvent);
    if (end === "up") app.onPetPointerUp();
    if (end === "released-buttons") app.onPetPointerMove({ ...down, buttons: 0 } as PointerEvent);
    expect(app.petPressed.value).toBe(false);
  });
  it.each([33, 50, 75] as const)("anchors the existing pill 34px above the pet at %s%%", async (scale) => {
    const app = await setup();
    for (const overlay of ["status", "panel", "decision"] as const) {
      app.renderedLayout.value = layoutFor(scale, overlay);
      expect(parseFloat(app.rootStyle.value["--panel-status-top"]!) - app.renderedLayout.value.pet.y).toBe(-34);
    }
  });
  it("starts a new App instance with the microphone idle", async () => {
    const app = await setup();
    expect(app.recordingLabel.value).toContain("未录音");
    expect(platform.track.stop).not.toHaveBeenCalled();
  });
});

describe("visual-only press contract", () => {
  it("scales a dedicated visual layer rather than the sprite hit target", () => {
    const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.pet-visual[\s\S]*?scale\(var\(--pet-press-scale/);
    expect(css).toContain("--pet-press-scale: .96");
    expect(css.match(/\.pet-visual\s*\{([^}]+)\}/)?.[1]).toContain("transform-origin: 50% 50%");
    const sprite = readFileSync(new URL("../src/components/SpritePet.vue", import.meta.url), "utf8");
    expect(sprite).toContain('class="pet-visual sprite-visual"');
  });
});
