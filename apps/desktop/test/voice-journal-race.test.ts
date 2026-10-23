import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityObservation, ActivityPage } from "@openclaw-pets/protocol";
import { PETS_RPC, PETS_PROTOCOL_VERSION } from "@openclaw-pets/protocol";
import type { Ref } from "vue";
import type * as Vue from "vue";

const runtime = vi.hoisted(() => ({
  mounted: [] as (() => void)[],
  request: vi.fn(),
}));

vi.mock("vue", async (load) => ({
  ...await load<typeof Vue>(),
  onMounted: (callback: () => void) => runtime.mounted.push(callback),
  onBeforeUnmount: vi.fn(),
  useSSRContext: () => ({ modules: new Set() }),
  watch: vi.fn(),
}));
vi.mock("../src/runtime/gateway-client.js", () => ({
  validateGatewayWebSocketUrl: (url: string) => url,
  PetsGatewayClient: class {
    connected = true;
    request = runtime.request;
    constructor(private options: { onStateChange: (state: string) => void; onHello: () => void }) {}
    start() { this.options.onStateChange("connected"); this.options.onHello(); }
    stop() {}
  },
}));
vi.mock("../src/runtime/window-controller.js", () => ({
  PetWindowController: class { async apply() {} async onFocusChanged() { return () => undefined; } async onCloseRequested() { return () => undefined; } },
}));
vi.mock("../src/runtime/pet-pack-loader.js", () => ({ loadActivePetPack: async () => undefined }));
vi.mock("../src/runtime/pet-pack-manager.js", () => ({
  PetPackManager: class { async list() { return []; } },
}));
vi.mock("../src/runtime/interaction-id.js", () => ({ createDeviceInteractionId: async () => "voice-in-flight" }));
vi.mock("../src/runtime/batch-recorder.js", async (load) => {
  const actual = await load<typeof import("../src/runtime/batch-recorder.js")>();
  return { ...actual, BatchRecorder: class extends actual.BatchRecorder {
    constructor() { super({
      getUserMedia: async () => ({ getTracks: () => [] }) as unknown as MediaStream,
      createRecorder: () => ({
        mimeType: "audio/webm", state: "inactive",
        onData() {}, onStop() {}, onError() {},
        start() { this.state = "recording"; },
        stop() { this.state = "inactive"; this.onData(new Blob(["audio"])); this.onStop(); },
      }),
    }); }
  } };
});

import App from "../src/App.vue";

type AppState = {
  activities: Ref<ActivityObservation[]>;
  activityCursor: Ref<string | undefined>;
  activityWarning: Ref<string>;
  editingActivityText: Ref<string>;
  toggleRecording(): Promise<void>;
  openPanel(tab: string): Promise<void>;
  beginActivityEdit(item: ActivityObservation): void;
  updateActivity(item: ActivityObservation): Promise<void>;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); runtime.mounted.length = 0; runtime.request.mockReset(); });

describe("voice processing while editing Journal (actual App handlers)", () => {
  it.each(["before-edit", "after-edit", "after-voice", "stale-error"])("keeps voice and manual edits when the older refresh resolves %s", async (timing) => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("localStorage", { getItem: (key: string) => key.endsWith("connection-configured") ? "true" : null, setItem: vi.fn(), removeItem: vi.fn() });
    const original: ActivityObservation = {
      id: "old-entry", text: "原始流水", revision: "rev-1", source: "voice",
      occurredAt: new Date().toISOString(),
    };
    let stored = [original];
    const asr = deferred<unknown>();
    const asrStarted = deferred<void>();
    const stalePage = deferred<ActivityPage>();
    let pageCalls = 0;
    runtime.request.mockImplementation(async (method: string, params: Record<string, unknown>) => {
      if (method === PETS_RPC.status) return { state: "idle", captureEnabled: true };
      if (method === PETS_RPC.capabilities) return { protocolVersion: PETS_PROTOCOL_VERSION, features: { batchTranscription: { available: true, health: "healthy" } } };
      if (method === PETS_RPC.activityList) {
        pageCalls += 1;
        if (pageCalls === 2) return stalePage.promise;
        return { status: "ok", observations: [...stored], gaps: [] };
      }
      if (method === PETS_RPC.transcriptionCreate) { asrStarted.resolve(); return asr.promise; }
      if (method === PETS_RPC.activityUpdate) {
        expect(params.expectedRevision).toBe("rev-1");
        const updated = { ...original, text: params.text as string, revision: "rev-2" };
        stored = stored.map((item) => item.id === updated.id ? updated : item);
        return { status: "updated", observation: updated };
      }
      if (method === PETS_RPC.utteranceRoute) return { route: "context", text: params.text };
      if (method === PETS_RPC.activityAppend) {
        const observation = params.observation as ActivityObservation;
        expect(observation.interactionId).toBe("voice-in-flight");
        stored = [observation, ...stored];
        return { inserted: true, observation };
      }
      throw new Error(`Unexpected RPC: ${method}`);
    });
    // Execute the compiled SFC's real setup/handlers, with only platform edges replaced.
    const setup = App.setup as unknown as (props: object, context: { expose: () => void }) => AppState;
    const app = setup({}, { expose: () => undefined });
    for (const mount of runtime.mounted) mount();
    await Promise.resolve();
    await Promise.resolve();
    await app.openPanel("activity");
    await app.toggleRecording();
    const processing = app.toggleRecording();
    await asrStarted.promise;
    const olderRefresh = app.openPanel("activity");
    const finishOlderRefresh = async () => {
      stalePage.resolve({ status: "ok", observations: [original], gaps: [], nextCursor: "stale-cursor" });
      await olderRefresh;
    };
    if (timing === "before-edit") await finishOlderRefresh();
    app.beginActivityEdit(original);
    app.editingActivityText.value = "手动修正流水";
    await app.updateActivity(original);
    if (timing === "after-edit") {
      await finishOlderRefresh();
      expect(app.activities.value.map((item) => item.text)).toEqual(["手动修正流水"]);
    }
    asr.resolve({ interactionId: "voice-in-flight", transcript: "新语音记录", provider: "test-asr" });
    await processing;
    expect(stored.map((item) => item.text)).toEqual(["新语音记录", "手动修正流水"]);
    if (timing === "after-voice") await finishOlderRefresh();
    if (timing === "stale-error") {
      stalePage.reject(new Error("old provider request failed"));
      await olderRefresh;
    }
    expect(app.activities.value.map((item) => item.text)).toEqual(["新语音记录", "手动修正流水"]);
    expect(app.activityCursor.value).toBeUndefined();
    expect(app.activityWarning.value).toBe("");
  });
});
