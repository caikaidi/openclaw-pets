import { afterEach, describe, expect, it, vi } from "vitest";
import type { Ref } from "vue";
import type * as Vue from "vue";
import type { TodoItem, ActivityObservation } from "@openclaw-pets/protocol";
import { PETS_RPC, PETS_PROTOCOL_VERSION } from "@openclaw-pets/protocol";
import { layoutFor } from "../src/runtime/window-layout.js";

const platform = vi.hoisted(() => ({
  stored: new Map<string, string>(), native: vi.fn(),
  unmounted: [] as (() => void)[], mounted: [] as (() => void)[], request: vi.fn(), drag: vi.fn(),
  state: undefined as undefined | ((value: string) => void),
  focus: undefined as undefined | ((focused: boolean) => void),
  track: { readyState: "live", stop: vi.fn() },
  port: undefined as undefined | { state: string; onData(blob: Blob): void; onStop(): void; onError(error: Error): void },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => platform.native(...args) }));
vi.mock("vue", async (load) => ({ ...await load<typeof Vue>(),
  onMounted: (callback: () => void) => platform.mounted.push(callback),
  onBeforeUnmount: (callback: () => void) => platform.unmounted.push(callback), useSSRContext: () => ({ modules: new Set() }), watch: vi.fn(),
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
  refreshTodos(force?: boolean): Promise<void>;
  todos: Ref<TodoItem[]>; editingTodoId: Ref<string | undefined>; editingTodoTitle: Ref<string>; editingTodoNotes: Ref<string>; todoEditError: Ref<string>;
  petFocused: Ref<boolean>; petFocusGlow: Ref<boolean>; beginTodoEdit(todo: TodoItem): void; saveTodoEdit(todo: TodoItem): Promise<void>;
  editingActivityText: Ref<string>; editingActivityId: Ref<string | undefined>; transientMessage: Ref<string>; beginActivityEdit(item: ActivityObservation): void; updateActivity(item: ActivityObservation): Promise<void>;
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
  platform.native.mockImplementation(async (command: string, args: { key: string; value?: string }) => {
    if (command === "secure_get") return platform.stored.get(args.key) ?? null;
    if (command === "secure_set") { platform.stored.set(args.key, args.value!); return; }
    throw new Error("Unexpected native command: " + command);
  });
  platform.drag.mockResolvedValue(undefined);
  platform.track.readyState = "live";
  platform.track.stop.mockImplementation(() => { platform.track.readyState = "ended"; });
  platform.request.mockImplementation(async (method: string) => {
    if (method === PETS_RPC.status) return { state: "idle" };
    if (method === PETS_RPC.capabilities) return { protocolVersion: PETS_PROTOCOL_VERSION, features: { todoSummary: { available: true }, batchTranscription: { available: true, health: "healthy" } } };
    if (method === PETS_RPC.transcriptionCreate) return new Promise(() => undefined);
    return { observations: [], gaps: [] };
  });
  const mountedBefore = platform.mounted.length;
  const app = (App.setup as unknown as (p: object, c: object) => State)({}, { expose() {} });
  platform.mounted.slice(mountedBefore).forEach((mount) => mount());
  await Promise.resolve(); await Promise.resolve();
  return app;
}
const down = { button: 0, buttons: 1, screenX: 20, screenY: 20 } as PointerEvent;
afterEach(() => { platform.unmounted.forEach((unmount) => unmount()); platform.unmounted.length = 0; vi.unstubAllGlobals(); vi.useRealTimers(); platform.mounted.length = 0; platform.request.mockReset(); platform.drag.mockReset(); platform.track.stop.mockReset(); platform.stored.clear(); platform.native.mockReset(); });

describe("App edit and visual-only focus integration", () => {
  it("finishes a Todo request while blurred and retains local revisions only for unchanged passive summaries", async () => {
    const app = await setup();
    const todo: TodoItem = { id: "pending", title: "原题", sourceObservationIds: ["source"] };
    let resolve!: (value: unknown) => void;
    platform.request.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const pending = app.refreshTodos(); platform.focus?.(true); platform.focus?.(false);
    const summary = { todos: [todo], generatedAt: "2026-09-09T00:00:00Z", observationsRead: 1, gaps: [] };
    resolve(summary); await pending;
    expect(app.petFocused.value).toBe(false); expect(app.todos.value).toEqual([todo]);
    app.beginTodoEdit(todo); app.editingTodoTitle.value = "修订"; await app.saveTodoEdit(todo);
    platform.request.mockResolvedValue(summary);
    await app.refreshTodos(); expect(app.todos.value[0]?.title).toBe("修订");
    await app.refreshTodos(true); expect(app.todos.value[0]?.title).toBe("原题");
  });
  it("restores saved local edits after a new App instance and passive summary; force resets them durably", async () => {
    const todo: TodoItem = { id: "stable", title: "原题", sourceObservationIds: ["source"] };
    const summary = { status: "ok", todos: [todo], generatedAt: "2026-09-09T00:00:00Z", observationsRead: 1, gaps: [] };
    const first = await setup(); platform.request.mockResolvedValue(summary); await first.refreshTodos();
    first.beginTodoEdit(todo); first.editingTodoTitle.value = "持久修订"; await first.saveTodoEdit(todo);
    const second = await setup(); platform.request.mockResolvedValue(summary); await second.refreshTodos();
    expect(second.todos.value[0]?.title).toBe("持久修订");
    await second.refreshTodos(true);
    const third = await setup(); platform.request.mockResolvedValue(summary); await third.refreshTodos();
    expect(third.todos.value[0]?.title).toBe("原题");
    expect(platform.request.mock.calls.every(([method]) => method !== PETS_RPC.activityUpdate)).toBe(true);
    expect(platform.native.mock.calls.every(([command]) => ["secure_get", "secure_set"].includes(command))).toBe(true);
  });
  it("keeps transcription and its interaction alive across focus loss", async () => {
    const app = await setup(); await app.toggleRecording();
    void app.toggleRecording(); platform.port?.onData(new Blob(["fixture audio"])); platform.port?.onStop();
    for (let i = 0; i < 12; i++) await Promise.resolve();
    const interaction = app.currentInteractionId.value;
    platform.focus?.(true); platform.focus?.(false);
    expect(app.recordingLabel.value).toContain("转写");
    expect(app.currentInteractionId.value).toBe(interaction);
  });
  it("retains failed Todo drafts and blocks duplicate saves/refresh while secure persistence is pending", async () => {
    const app = await setup(); const todo: TodoItem = { id: "pending-save", title: "旧题", sourceObservationIds: ["source"] };
    app.todos.value = [todo]; app.beginTodoEdit(todo); app.editingTodoTitle.value = "新题";
    let reject!: (error: Error) => void;
    platform.native.mockImplementation((command: string) => command === "secure_get" ? Promise.resolve(null) : new Promise((_done, fail) => { reject = fail; }));
    const first = app.saveTodoEdit(todo); await Promise.resolve(); await Promise.resolve();
    await app.saveTodoEdit(todo); const requests = platform.request.mock.calls.length; await app.refreshTodos(true);
    expect(platform.request.mock.calls.length).toBe(requests);
    expect(platform.native.mock.calls.filter(([command]) => command === "secure_set")).toHaveLength(1);
    reject(new Error("fixture persistence denied")); await first;
    expect(app.todos.value[0]?.title).toBe("旧题"); expect(app.editingTodoTitle.value).toBe("新题");
    expect(app.editingTodoId.value).toBe(todo.id); expect(app.todoEditError.value).toContain("fixture persistence denied");
  });
  it("edits a Todo locally, rejects blank text, and ignores duplicate saves", async () => {
    const app = await setup();
    const todo: TodoItem = { id: "local", title: "旧题", sourceObservationIds: ["source"] };
    app.todos.value = [todo]; app.beginTodoEdit(todo); app.editingTodoTitle.value = " ";
    await app.saveTodoEdit(todo); expect(app.todoEditError.value).toContain("不能为空");
    expect(app.editingTodoId.value).toBe("local");
    app.editingTodoTitle.value = "新题\n第二行"; app.editingTodoNotes.value = "备注";
    const before = platform.request.mock.calls.length;
    await app.saveTodoEdit(todo); await app.saveTodoEdit(todo);
    expect(app.todos.value[0]).toEqual({ ...todo, title: "新题\n第二行", notes: "备注" });
    expect(platform.request.mock.calls.length).toBe(before);
    expect(app.editingTodoId.value).toBeUndefined();
  });
  it("retains a failed Journal draft and protects an in-flight save", async () => {
    const app = await setup();
    const item: ActivityObservation = { id: "entry", text: "original", source: "voice", revision: "r1", occurredAt: "2026-09-09T00:00:00Z" };
    app.beginActivityEdit(item); app.editingActivityText.value = "corrected";
    let reject!: (error: Error) => void;
    platform.request.mockImplementation((method: string) => method === PETS_RPC.activityUpdate ? new Promise((_resolve, fail) => { reject = fail; }) : Promise.resolve({ observations: [], gaps: [] }));
    const first = app.updateActivity(item); await app.updateActivity(item);
    expect(platform.request.mock.calls.filter(([method]) => method === PETS_RPC.activityUpdate)).toHaveLength(1);
    reject(new Error("fixture failure")); await first;
    expect(app.editingActivityText.value).toBe("corrected"); expect(app.editingActivityId.value).toBe("entry");
    expect(app.transientMessage.value).toContain("fixture failure");
  });
  it("native blur pauses visuals but leaves capture running; regain glows only briefly", async () => {
    const app = await setup(); await app.toggleRecording();
    platform.focus?.(true); app.panel.value = "todo";
    platform.focus?.(false);
    expect(app.petFocused.value).toBe(false); expect(app.panel.value).toBeUndefined();
    expect(platform.port?.state).toBe("recording"); expect(platform.track.stop).not.toHaveBeenCalled();
    platform.focus?.(true); expect(app.petFocused.value).toBe(true); expect(app.petFocusGlow.value).toBe(true);
    await vi.advanceTimersByTimeAsync(700); expect(app.petFocusGlow.value).toBe(false);
    expect(app.recordingLabel.value).toContain("采音中");
  });
});
