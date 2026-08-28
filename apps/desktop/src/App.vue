<script setup lang="ts">
import type {
  ActivityPage,
  ActivityObservation,
  AsrCapability,
  PetSemanticState,
  PetStatus,
  TodoItem,
  TodoSummary,
  TranscriptionResult,
  UtteranceRoute,
} from "@openclaw-pets/protocol";
import {
  PETS_EVENT,
  PETS_RPC,
  PET_SEMANTIC_STATES,
  isPetSemanticState,
} from "@openclaw-pets/protocol";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import PetCanvas from "./components/PetCanvas.vue";
import SpritePet from "./components/SpritePet.vue";
import { BatchRecorder } from "./runtime/batch-recorder.js";
import {
  activityGapMessage,
  activitySourceLabel,
  recentTodoWindow,
  todayActivityWindow,
} from "./runtime/activity-journal.js";
import { ActivityEditConflictError, saveActivityEdit } from "./runtime/activity-editor.js";
import {
  addTodoToAppleCalendar,
  addTodoToAppleReminders,
  suggestedCalendarWindow,
} from "./runtime/apple-task-export.js";
import { transcribeRecording } from "./runtime/batch-transcription.js";
import { asrCapabilityLabel, isCompatibleCapabilities } from "./runtime/asr-status.js";
import {
  resolveDisplayState,
  shouldApplyInteractionStatus,
  type InteractionDisplayState,
} from "./runtime/display-state.js";
import {
  PetsGatewayClient,
  validateGatewayWebSocketUrl,
  type GatewayConnectionState,
} from "./runtime/gateway-client.js";
import { clearConnectionCredential, writeConnectionCredential } from "./runtime/secure-store.js";
import { loadActivePetPack, type LoadedPetPack } from "./runtime/pet-pack-loader.js";
import { PetPackManager, type PetPackSummary } from "./runtime/pet-pack-manager.js";
import { createDeviceInteractionId } from "./runtime/interaction-id.js";
import { submitUtterance } from "./runtime/utterance-router.js";
import {
  PET_SCALES,
  isPetScale,
  layoutFor,
  panelStatusCenterX,
  type PetOverlay,
  type PetScale,
  type PetWindowLayout,
} from "./runtime/window-layout.js";
import { PetWindowController } from "./runtime/window-controller.js";

type PanelTab = "activity" | "todo" | "settings";
type ActivityDeleteResponse = { deleted?: boolean };
type CapabilitiesResponse = {
  protocolVersion?: unknown;
  features?: {
    batchTranscription?: AsrCapability;
    todoSummary?: { available?: boolean; maxItems?: number };
  };
};
type PendingDecision = Pick<TranscriptionResult, "interactionId" | "provider"> & {
  text: string;
  transcript?: string;
};

const stateLabels: Record<PetSemanticState, string> = {
  offline: "等待连接 OpenClaw",
  idle: "",
  listening: "正在聆听",
  transcribing: "正在转写",
  thinking: "正在思考",
  working: "正在执行",
  needs_input: "需要你的确认",
  speaking: "正在播报",
  succeeded: "已完成",
  failed: "遇到问题了",
};

const previewStateLabels: Record<PetSemanticState, string> = {
  offline: "离线",
  idle: "待机",
  listening: "聆听",
  transcribing: "转写",
  thinking: "思考",
  working: "执行",
  needs_input: "确认",
  speaking: "播报",
  succeeded: "成功",
  failed: "失败",
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function storedScale(): PetScale {
  const parsed = Number(localStorage.getItem("openclaw-pets.scale"));
  return isPetScale(parsed) ? parsed : 33;
}

const gatewayUrl = ref(localStorage.getItem("openclaw-pets.gateway-url") ?? "ws://127.0.0.1:18789");
const connectionConfigured = localStorage.getItem("openclaw-pets.connection-configured") === "true";
const gatewayDraft = ref(gatewayUrl.value);
const connectionCredential = ref("");
const scale = ref<PetScale>(storedScale());
const connection = ref<GatewayConnectionState>("disconnected");
const detail = ref("");
const pluginAvailable = ref(false);
const backendState = ref<PetSemanticState>("idle");
const interactionState = ref<InteractionDisplayState>();
const currentInteractionId = ref<string | undefined>(
  localStorage.getItem("openclaw-pets.active-interaction") ?? undefined,
);
const asrCapability = ref<AsrCapability>({ available: false, health: "unconfigured" });
const todoAvailable = ref(false);
const recording = ref(false);
const decision = ref<PendingDecision>();
const panel = ref<PanelTab | undefined>(connectionConfigured ? undefined : "settings");
const activities = ref<ActivityObservation[]>([]);
const activityCursor = ref<string>();
const activityWarning = ref("");
const todos = ref<TodoItem[]>([]);
const todoWarning = ref("");
const todoGeneratedAt = ref<string>();
const todoObservationsRead = ref(0);
const todoLoading = ref(false);
const appleExportBusy = ref<string>();
const calendarTodoIds = ref(new Set<string>());
const reminderTodoIds = ref(new Set<string>());
const editingActivityId = ref<string>();
const editingActivityText = ref("");
const savingActivityId = ref<string>();
const captureEnabled = ref(true);
const transientMessage = ref("");
const activePetPack = ref<LoadedPetPack>();
const previewPetPack = ref<LoadedPetPack>();
const previewPetPackKey = ref<string>();
const previewPetState = ref<PetSemanticState>("idle");
const installedPetPacks = ref<PetPackSummary[]>([]);
const petPackBusy = ref(false);
let transientTimer: number | undefined;
let interactionTimer: number | undefined;
let recordingTransition = false;
let activityWindow = todayActivityWindow();

function setCurrentInteractionId(interactionId?: string): void {
  currentInteractionId.value = interactionId;
  if (interactionId) localStorage.setItem("openclaw-pets.active-interaction", interactionId);
  else localStorage.removeItem("openclaw-pets.active-interaction");
}

const displayState = computed(() => resolveDisplayState({
  connected: connection.value === "connected",
  backendState: backendState.value,
  ...(interactionState.value ? { interactionState: interactionState.value } : {}),
}));
const statusText = computed(() => transientMessage.value || stateLabels[displayState.value]);
const overlay = computed<PetOverlay>(() => {
  if (panel.value) return "panel";
  if (decision.value) return "decision";
  return statusText.value ? "status" : "none";
});
const renderedLayout = ref<PetWindowLayout>(layoutFor(33, "status"));
const rootStyle = computed(() => ({
  "--pet-left": `${renderedLayout.value.pet.x}px`,
  "--pet-top": `${renderedLayout.value.pet.y}px`,
  "--pet-width": `${renderedLayout.value.pet.width}px`,
  "--pet-height": `${renderedLayout.value.pet.height}px`,
  "--overlay-left": `${renderedLayout.value.overlay?.x ?? 0}px`,
  "--overlay-top": `${renderedLayout.value.overlay?.y ?? 0}px`,
  "--overlay-width": `${renderedLayout.value.overlay?.width ?? 0}px`,
  "--overlay-height": `${renderedLayout.value.overlay?.height ?? 0}px`,
  "--overlay-anchor-x": `${renderedLayout.value.overlayAnchorX ?? 0}px`,
  "--panel-status-left": `${panelStatusCenterX(renderedLayout.value)}px`,
  "--panel-status-top": `${(renderedLayout.value.overlay?.y ?? 0) + (renderedLayout.value.overlay?.height ?? 0) + 6}px`,
}));

// tauri.conf.json always launches at the 33% status layout before Vue restores preferences.
const windowController = new PetWindowController(33, "status");
let gateway: PetsGatewayClient | undefined;
const recorder = new BatchRecorder();
const petPackManager = new PetPackManager();
const renderedPetPack = computed(() => previewPetPack.value ?? activePetPack.value);
const renderedPetState = computed(() => previewPetPack.value ? previewPetState.value : displayState.value);

function showTransient(message: string, duration = 2_800): void {
  transientMessage.value = message;
  if (transientTimer !== undefined) window.clearTimeout(transientTimer);
  transientTimer = window.setTimeout(() => {
    transientMessage.value = "";
  }, duration);
}

function readableError(cause: unknown): string {
  if (cause instanceof Error) return cause.message.slice(0, 180);
  if (typeof cause === "string" && cause.trim()) return cause.trim().slice(0, 180);
  return "操作失败";
}

function showTerminal(state: Extract<InteractionDisplayState, "succeeded" | "failed">): void {
  interactionState.value = state;
  if (interactionTimer !== undefined) window.clearTimeout(interactionTimer);
  interactionTimer = window.setTimeout(() => {
    if (interactionState.value === state) interactionState.value = undefined;
    setCurrentInteractionId();
  }, 3_000);
}

async function refreshCapabilities(): Promise<void> {
  if (!gateway?.connected) return;
  try {
    const capabilities = await gateway.request<CapabilitiesResponse>(PETS_RPC.capabilities);
    if (!isCompatibleCapabilities(capabilities)) {
      pluginAvailable.value = false;
      asrCapability.value = { available: false, health: "unconfigured" };
      todoAvailable.value = false;
      showTransient("OpenClaw Pets 插件协议不兼容，请升级插件", 5_000);
      return;
    }
    asrCapability.value = capabilities.features?.batchTranscription
      ?? { available: false, health: "unconfigured" };
    todoAvailable.value = capabilities.features?.todoSummary?.available === true;
  } catch {
    asrCapability.value = { available: false, health: "unconfigured" };
    todoAvailable.value = false;
  }
}

async function refreshStatus(): Promise<void> {
  if (!gateway?.connected) return;
  try {
    const status = await gateway.request<PetStatus & { captureEnabled?: boolean }>(PETS_RPC.status, {
      ...(currentInteractionId.value ? { interactionId: currentInteractionId.value } : {}),
    });
    pluginAvailable.value = true;
    backendState.value = status.state;
    if (status.state === "idle" && currentInteractionId.value) setCurrentInteractionId();
    if (typeof status.captureEnabled === "boolean") captureEnabled.value = status.captureEnabled;
  } catch {
    pluginAvailable.value = false;
    backendState.value = "idle";
    showTransient("请安装 OpenClaw Pets 插件", 5_000);
  }
}

async function refreshActivities(append = false): Promise<void> {
  if (!gateway?.connected || !pluginAvailable.value) return;
  try {
    if (!append) activityWindow = todayActivityWindow();
    const response = await gateway.request<ActivityPage>(PETS_RPC.activityList, {
      limit: 30,
      ...activityWindow,
      ...(append && activityCursor.value ? { cursor: activityCursor.value } : {}),
    });
    const next = Array.isArray(response.observations) ? response.observations : [];
    activities.value = append ? [...activities.value, ...next] : next;
    activityCursor.value = response.nextCursor;
    activityWarning.value = activityGapMessage(response);
  } catch (cause) {
    activityWarning.value = "流水账暂时无法完整读取";
    showTransient(readableError(cause));
  }
}

async function refreshTodos(): Promise<void> {
  if (todoLoading.value) return;
  if (!gateway?.connected || !pluginAvailable.value) {
    todoWarning.value = "OpenClaw Pets 插件尚未连接";
    return;
  }
  if (!todoAvailable.value) {
    todoWarning.value = "当前插件不支持 Todo 总结，请升级 Gateway 插件";
    return;
  }
  todoLoading.value = true;
  todoWarning.value = "";
  try {
    const response = await gateway.request<TodoSummary>(PETS_RPC.todoGenerate, {
      ...recentTodoWindow(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    todos.value = response.todos;
    todoGeneratedAt.value = response.generatedAt;
    todoObservationsRead.value = response.observationsRead;
    calendarTodoIds.value = new Set();
    reminderTodoIds.value = new Set();
    const reasons = response.gaps.map((gap) => gap.reason).filter(Boolean).join("；");
    if (response.status !== "ok" || response.gaps.length > 0) {
      todoWarning.value = `Todo 可能不完整${reasons ? `：${reasons}` : ""}`;
    }
  } catch (cause) {
    todoWarning.value = readableError(cause);
  } finally {
    todoLoading.value = false;
  }
}

function todoDueLabel(todo: TodoItem): string {
  if (todo.dueAt) return `截止 ${new Date(todo.dueAt).toLocaleString()}`;
  const suggested = suggestedCalendarWindow(todo, new Date(todoGeneratedAt.value ?? Date.now()));
  return `未注明时间 · 日历默认 ${suggested.start.toLocaleString()}`;
}

async function exportTodoToCalendar(todo: TodoItem): Promise<void> {
  if (appleExportBusy.value) return;
  appleExportBusy.value = `calendar:${todo.id}`;
  try {
    const scheduled = await addTodoToAppleCalendar(todo, new Date(todoGeneratedAt.value ?? Date.now()));
    calendarTodoIds.value = new Set(calendarTodoIds.value).add(todo.id);
    showTransient(scheduled.inferred ? "已加入 Apple 日历（使用卡片显示的默认时间）" : "已加入 Apple 日历");
  } catch (cause) {
    showTransient(readableError(cause), 5_000);
  } finally {
    appleExportBusy.value = undefined;
  }
}

async function exportTodoToReminders(todo: TodoItem): Promise<void> {
  if (appleExportBusy.value) return;
  appleExportBusy.value = `reminder:${todo.id}`;
  try {
    await addTodoToAppleReminders(todo);
    reminderTodoIds.value = new Set(reminderTodoIds.value).add(todo.id);
    showTransient("已加入 Apple 提醒事项");
  } catch (cause) {
    showTransient(readableError(cause), 5_000);
  } finally {
    appleExportBusy.value = undefined;
  }
}

async function refreshPetPack(): Promise<void> {
  try {
    activePetPack.value = (await loadActivePetPack()) ?? undefined;
    showTransient(activePetPack.value ? `已加载 ${activePetPack.value.manifest.name}` : "使用内置开源宠物");
  } catch (cause) {
    activePetPack.value = undefined;
    showTransient(readableError(cause), 5_000);
  }
}

async function refreshInstalledPetPacks(): Promise<void> {
  try {
    installedPetPacks.value = await petPackManager.list();
  } catch (cause) {
    showTransient(readableError(cause), 5_000);
  }
}

async function openPetdex(): Promise<void> {
  try {
    await petPackManager.openPetdex();
  } catch (cause) {
    showTransient(readableError(cause));
  }
}

async function importPetPack(kind: "zip" | "directory"): Promise<void> {
  if (petPackBusy.value) return;
  petPackBusy.value = true;
  try {
    const imported = await petPackManager.import(kind);
    if (!imported) return;
    previewPetPack.value = imported.preview;
    previewPetPackKey.value = imported.summary.key;
    previewPetState.value = "idle";
    await refreshInstalledPetPacks();
    showTransient(`正在预览 ${imported.summary.name}，确认后再启用`);
  } catch (cause) {
    showTransient(readableError(cause), 5_000);
  } finally {
    petPackBusy.value = false;
  }
}

async function previewInstalledPetPack(pack: PetPackSummary): Promise<void> {
  if (petPackBusy.value) return;
  petPackBusy.value = true;
  try {
    previewPetPack.value = await petPackManager.preview(pack.key);
    previewPetPackKey.value = pack.key;
    previewPetState.value = "idle";
    showTransient(`正在预览 ${pack.name}`);
  } catch (cause) {
    showTransient(readableError(cause), 5_000);
  } finally {
    petPackBusy.value = false;
  }
}

async function activateInstalledPetPack(pack: PetPackSummary): Promise<void> {
  if (petPackBusy.value) return;
  petPackBusy.value = true;
  try {
    activePetPack.value = await petPackManager.activate(pack.key);
    previewPetPack.value = undefined;
    previewPetPackKey.value = undefined;
    previewPetState.value = "idle";
    await refreshInstalledPetPacks();
    showTransient(`已启用 ${pack.name}`);
  } catch (cause) {
    showTransient(readableError(cause), 5_000);
  } finally {
    petPackBusy.value = false;
  }
}

async function removeInstalledPetPack(pack: PetPackSummary): Promise<void> {
  if (petPackBusy.value || pack.active) return;
  petPackBusy.value = true;
  try {
    await petPackManager.remove(pack.key);
    if (previewPetPackKey.value === pack.key) {
      previewPetPack.value = undefined;
      previewPetPackKey.value = undefined;
      previewPetState.value = "idle";
    }
    await refreshInstalledPetPacks();
    showTransient(`已移除 ${pack.name}`);
  } catch (cause) {
    showTransient(readableError(cause), 5_000);
  } finally {
    petPackBusy.value = false;
  }
}

function closePanel(): void {
  panel.value = undefined;
  previewPetPack.value = undefined;
  previewPetPackKey.value = undefined;
  previewPetState.value = "idle";
}

async function deleteActivity(id: string): Promise<void> {
  if (!gateway?.connected || !pluginAvailable.value) return;
  try {
    const response = await gateway.request<ActivityDeleteResponse>(PETS_RPC.activityDelete, { id });
    if (!response.deleted) {
      showTransient("这条记录已不存在，正在刷新列表");
      await refreshActivities();
      return;
    }
    await refreshActivities();
  } catch (cause) {
    showTransient(readableError(cause));
  }
}

function beginActivityEdit(observation: ActivityObservation): void {
  editingActivityId.value = observation.id;
  editingActivityText.value = observation.text;
}

function cancelActivityEdit(): void {
  editingActivityId.value = undefined;
  editingActivityText.value = "";
}

async function updateActivity(observation: ActivityObservation): Promise<void> {
  if (!gateway?.connected || !pluginAvailable.value || savingActivityId.value) return;
  savingActivityId.value = observation.id;
  try {
    const updated = await saveActivityEdit(
      (method, params) => gateway!.request(method, params),
      observation,
      editingActivityText.value,
    );
    activities.value = activities.value.map((item) => item.id === updated.id ? updated : item);
    cancelActivityEdit();
    showTransient("流水账已修改");
  } catch (cause) {
    if (cause instanceof ActivityEditConflictError) {
      activities.value = activities.value.map((item) => item.id === cause.current.id ? cause.current : item);
      editingActivityText.value = cause.current.text;
      showTransient("这条流水已在另一台电脑修改，请确认最新内容后重试", 5_000);
    } else {
      showTransient(readableError(cause));
    }
  } finally {
    savingActivityId.value = undefined;
  }
}

function handleGatewayEvent(event: { event: string; payload?: unknown }): void {
  if (event.event === PETS_EVENT.changed) {
    const payload = record(event.payload);
    const interactionId = typeof payload.interactionId === "string" ? payload.interactionId : undefined;
    if (isPetSemanticState(payload.state)
      && shouldApplyInteractionStatus(currentInteractionId.value, { interactionId })) {
      backendState.value = payload.state;
      interactionState.value = undefined;
      if (payload.state === "idle") setCurrentInteractionId();
    }
  }
}

async function dispatchUtterance(transcription: PendingDecision, requestedRoute?: UtteranceRoute): Promise<void> {
  if (!gateway?.connected || !pluginAvailable.value) {
    showTransient("OpenClaw Pets 插件尚未连接");
    return;
  }
  try {
    interactionState.value = "thinking";
    const result = await submitUtterance(
      (method, params) => gateway!.request(method, params),
      {
        text: transcription.transcript ?? transcription.text,
        ...(transcription.transcript ? { actionText: transcription.text } : {}),
        interactionId: transcription.interactionId,
        asrProvider: transcription.provider,
        ...(requestedRoute ? { requestedRoute } : {}),
      },
    );
    if (result.kind === "confirm") {
      panel.value = undefined;
      decision.value = { ...transcription, text: result.text, transcript: result.transcript };
      interactionState.value = "needs_input";
      return;
    }
    decision.value = undefined;
    showTransient(result.kind === "context" ? "已补充到 OpenClaw 上下文" : "任务已交给 OpenClaw");
    if (result.kind === "context") {
      await refreshActivities();
      if (panel.value === "todo") await refreshTodos();
      showTerminal("succeeded");
    } else {
      interactionState.value = undefined;
    }
  } catch (cause) {
    showTerminal("failed");
    showTransient(readableError(cause), 5_000);
  }
}

async function toggleRecording(): Promise<void> {
  if (recordingTransition) return;
  if (!gateway?.connected) {
    showTransient("OpenClaw Gateway 尚未连接");
    return;
  }
  if (!pluginAvailable.value || !asrCapability.value.available) {
    showTransient("请先在 OpenClaw Pets 插件中配置批量转写 Provider", 5_000);
    return;
  }
  recordingTransition = true;
  try {
    if (recording.value) {
      recording.value = false;
      interactionState.value = "transcribing";
      const interactionId = currentInteractionId.value;
      if (!interactionId) throw new Error("录音交互已失效，请重新开始");
      const audio = await recorder.stop();
      const result = await transcribeRecording(
        (method, params, options) => gateway!.request(method, params, options),
        interactionId,
        audio,
      );
      await refreshCapabilities();
      await dispatchUtterance({
        interactionId,
        text: result.transcript,
        provider: result.provider,
      });
      return;
    }
    setCurrentInteractionId(await createDeviceInteractionId());
    interactionState.value = "listening";
    await recorder.start();
    recording.value = true;
  } catch (cause) {
    recording.value = false;
    await refreshCapabilities();
    showTerminal("failed");
    showTransient(readableError(cause), 5_000);
  } finally {
    recordingTransition = false;
  }
}

async function chooseRoute(route: Exclude<UtteranceRoute, "confirm">): Promise<void> {
  const text = decision.value;
  decision.value = undefined;
  if (text) await dispatchUtterance(text, route);
}

function cancelDecision(): void {
  decision.value = undefined;
  interactionState.value = undefined;
  setCurrentInteractionId();
}

function selectScale(value: PetScale): void {
  scale.value = value;
  localStorage.setItem("openclaw-pets.scale", String(value));
}

async function openPanel(tab: PanelTab): Promise<void> {
  panel.value = tab;
  if (tab === "activity") await refreshActivities();
  if (tab === "todo") await refreshTodos();
  if (tab === "settings") await refreshInstalledPetPacks();
}

async function setCapture(enabled: boolean): Promise<void> {
  if (!gateway?.connected || !pluginAvailable.value) return;
  try {
    await gateway.request(PETS_RPC.captureSet, { enabled });
    captureEnabled.value = enabled;
  } catch (cause) {
    showTransient(readableError(cause));
  }
}

async function saveConnection(): Promise<void> {
  let nextUrl: string;
  try {
    nextUrl = validateGatewayWebSocketUrl(gatewayDraft.value);
  } catch (cause) {
    showTransient(readableError(cause));
    return;
  }
  localStorage.setItem("openclaw-pets.gateway-url", nextUrl);
  localStorage.setItem("openclaw-pets.connection-configured", "true");
  if (connectionCredential.value.trim()) {
    await writeConnectionCredential(nextUrl, connectionCredential.value.trim());
  }
  connectionCredential.value = "";
  location.reload();
}

async function forgetConnectionCredential(): Promise<void> {
  await clearConnectionCredential(gatewayDraft.value.trim());
  connectionCredential.value = "";
  showTransient("已移除连接凭据");
}

let pointerStart: { x: number; y: number } | undefined;
let dragging = false;
function onPetPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  pointerStart = { x: event.screenX, y: event.screenY };
  dragging = false;
}
function onPetPointerMove(event: PointerEvent): void {
  if (!pointerStart || dragging || (event.buttons & 1) === 0) return;
  if (Math.hypot(event.screenX - pointerStart.x, event.screenY - pointerStart.y) < 6) return;
  dragging = true;
  void windowController.startDragging();
}
function onPetPointerUp(): void {
  const shouldClick = Boolean(pointerStart) && !dragging;
  pointerStart = undefined;
  dragging = false;
  if (shouldClick) void toggleRecording();
}

function onPetPointerCancel(): void {
  pointerStart = undefined;
  dragging = false;
}

function onPetContextMenu(): void {
  void openPanel("activity");
}

watch([scale, overlay], ([nextScale, nextOverlay]) => {
  void windowController.apply(nextScale, nextOverlay, async (nextLayout) => {
    renderedLayout.value = nextLayout;
    await nextTick();
  });
});

onMounted(() => {
  void windowController.apply(scale.value, overlay.value, async (nextLayout) => {
    renderedLayout.value = nextLayout;
    await nextTick();
  });
  void refreshPetPack();
  void refreshInstalledPetPacks();
  if (!connectionConfigured) return;
  gateway = new PetsGatewayClient({
    url: gatewayUrl.value,
    appVersion: "0.5.0",
    onStateChange: (state, message) => {
      connection.value = state;
      detail.value = message ?? "";
    },
    onHello: () => void Promise.all([refreshStatus(), refreshCapabilities()]),
    onEvent: handleGatewayEvent,
  });
  gateway.start();
});

onBeforeUnmount(() => {
  if (transientTimer !== undefined) window.clearTimeout(transientTimer);
  if (interactionTimer !== undefined) window.clearTimeout(interactionTimer);
  if (recorder.recording) void recorder.stop().catch(() => undefined);
  gateway?.stop();
});
</script>

<template>
  <main class="pet-window" :style="rootStyle">
    <section v-if="panel" class="floating-panel" @pointerdown.stop>
      <header class="panel-header">
        <nav>
          <button :class="{ active: panel === 'activity' }" @click="openPanel('activity')">活动记录</button>
          <button :class="{ active: panel === 'todo' }" @click="openPanel('todo')">Todo</button>
          <button :class="{ active: panel === 'settings' }" @click="openPanel('settings')">设置</button>
        </nav>
        <button class="icon-button" aria-label="关闭" @click="closePanel">×</button>
      </header>

      <div v-if="panel === 'activity'" class="panel-body activity-list">
        <p v-if="activityWarning" class="activity-warning">{{ activityWarning }}</p>
        <p v-if="activities.length === 0 && !activityWarning" class="empty">今天还没有流水账。</p>
        <article v-for="item in activities" :key="item.id">
          <div class="activity-meta">
            <time>
              {{ new Date(item.occurredAt).toLocaleString() }}
              <span v-if="item.editedAt"> · 已编辑</span>
            </time>
            <div class="activity-actions">
              <button aria-label="编辑这条记录" @click="beginActivityEdit(item)">编辑</button>
              <button aria-label="删除这条记录" @click="deleteActivity(item.id)">删除</button>
            </div>
          </div>
          <template v-if="editingActivityId === item.id">
            <textarea v-model="editingActivityText" class="activity-edit" rows="3" maxlength="8000" />
            <div class="activity-edit-actions">
              <button class="secondary" @click="cancelActivityEdit">取消</button>
              <button
                class="primary"
                :disabled="savingActivityId === item.id || !editingActivityText.trim()"
                @click="updateActivity(item)"
              >保存</button>
            </div>
          </template>
          <p v-else>{{ item.text }}</p>
          <small>{{ [activitySourceLabel(item.source), item.asrProvider, item.route].filter(Boolean).join(" · ") }}</small>
        </article>
        <button v-if="activityCursor" class="secondary load-more" @click="refreshActivities(true)">加载更早记录</button>
      </div>

      <div v-else-if="panel === 'todo'" class="panel-body todo-list">
        <div class="todo-summary-meta">
          <div>
            <strong>从最近 30 天流水账生成</strong>
            <small v-if="todoGeneratedAt">
              {{ todoObservationsRead }} 条来源 · {{ new Date(todoGeneratedAt).toLocaleTimeString() }} 更新
            </small>
          </div>
          <button class="secondary" :disabled="todoLoading" @click="refreshTodos">
            {{ todoLoading ? "总结中…" : "重新总结" }}
          </button>
        </div>
        <p v-if="todoWarning" class="activity-warning">{{ todoWarning }}</p>
        <p v-if="todoLoading && todos.length === 0" class="empty">正在从流水账总结 Todo…</p>
        <p v-else-if="!todoLoading && todos.length === 0 && !todoWarning" class="empty">
          最近 30 天流水账里没有未完成待办。
        </p>
        <article v-for="todo in todos" :key="todo.id" class="todo-card">
          <div class="todo-copy">
            <strong>{{ todo.title }}</strong>
            <p v-if="todo.notes">{{ todo.notes }}</p>
            <small>{{ todoDueLabel(todo) }} · 来源 {{ todo.sourceObservationIds.length }} 条流水</small>
          </div>
          <div class="todo-actions">
            <button
              class="secondary apple-action"
              :disabled="Boolean(appleExportBusy) || calendarTodoIds.has(todo.id)"
              @click="exportTodoToCalendar(todo)"
            >{{ calendarTodoIds.has(todo.id) ? "已加入日历" : "加入 Apple 日历" }}</button>
            <button
              class="primary apple-action"
              :disabled="Boolean(appleExportBusy) || reminderTodoIds.has(todo.id)"
              @click="exportTodoToReminders(todo)"
            >{{ reminderTodoIds.has(todo.id) ? "已加入提醒" : "加入提醒事项" }}</button>
          </div>
        </article>
      </div>

      <div v-else class="panel-body settings-form">
        <label>
          Gateway WebSocket
          <input v-model="gatewayDraft" type="url" spellcheck="false" />
        </label>
        <label>
          Gateway 连接凭据（仅保存到系统安全存储）
          <input v-model="connectionCredential" type="password" autocomplete="off" placeholder="留空则保持不变" />
        </label>
        <div class="setting-row">
          <span>宠物尺寸</span>
          <div class="segmented">
            <button v-for="value in PET_SCALES" :key="value" :class="{ active: scale === value }" @click="selectScale(value)">
              {{ value }}%
            </button>
          </div>
        </div>
        <section class="pet-pack-settings">
          <div class="setting-row">
            <span>宠物形象</span>
            <small>{{ activePetPack?.manifest.name ?? "内置宠物" }}</small>
          </div>
          <div class="pet-pack-import-actions">
            <button class="secondary" @click="openPetdex">浏览 Petdex</button>
            <button class="secondary" :disabled="petPackBusy" @click="importPetPack('zip')">导入 ZIP</button>
            <button class="secondary" :disabled="petPackBusy" @click="importPetPack('directory')">导入文件夹</button>
          </div>
          <p class="pet-pack-note">从 codex-pets.net 下载后导入。本地素材不会上传或重新分发。</p>
          <div v-if="previewPetPack" class="preview-state-picker" aria-label="预览宠物状态">
            <button
              v-for="state in PET_SEMANTIC_STATES"
              :key="state"
              class="secondary"
              :class="{ active: previewPetState === state }"
              @click="previewPetState = state"
            >{{ previewStateLabels[state] }}</button>
          </div>
          <div v-if="installedPetPacks.length" class="pet-pack-list">
            <article v-for="pack in installedPetPacks" :key="pack.key" :class="{ previewing: previewPetPackKey === pack.key }">
              <div>
                <strong>{{ pack.name }}</strong>
                <small>{{ pack.active ? "当前使用" : pack.license === "NOASSERTION" ? "本地使用 · 授权未声明" : pack.license }}</small>
              </div>
              <div class="pet-pack-actions">
                <button class="secondary" :disabled="petPackBusy" @click="previewInstalledPetPack(pack)">预览</button>
                <button v-if="!pack.active" class="primary" :disabled="petPackBusy" @click="activateInstalledPetPack(pack)">启用</button>
                <button v-if="!pack.active" class="secondary danger" :disabled="petPackBusy" @click="removeInstalledPetPack(pack)">移除</button>
              </div>
            </article>
          </div>
        </section>
        <div class="setting-row">
          <span>重新读取当前 Pet Pack</span>
          <button @click="refreshPetPack">重新载入</button>
        </div>
        <div class="setting-row">
          <span>语音转写</span>
          <small>{{ asrCapabilityLabel(asrCapability) }}</small>
        </div>
        <div class="setting-row">
          <span>活动记录</span>
          <button class="toggle" :aria-pressed="captureEnabled" @click="setCapture(!captureEnabled)">
            {{ captureEnabled ? "已开启" : "已暂停" }}
          </button>
        </div>
        <div class="settings-actions">
          <button class="secondary" @click="forgetConnectionCredential">移除连接凭据</button>
          <button class="primary" @click="saveConnection">保存并重连</button>
        </div>
      </div>
    </section>

    <section v-if="panel && statusText" class="panel-status" role="status">
      <span class="state-dot" :data-state="displayState" />
      <strong>{{ statusText }}</strong>
    </section>

    <section v-if="!panel && decision" class="decision-card" @pointerdown.stop>
      <p class="eyebrow">如何处理这段语音？</p>
      <p class="decision-text">{{ decision.text }}</p>
      <div class="decision-actions">
        <button class="route-choice secondary" @click="chooseRoute('context')">
          记录流水账
        </button>
        <button class="route-choice primary" @click="chooseRoute('agent')">
          交给 OpenClaw 执行
        </button>
        <button class="cancel-route" @click="cancelDecision">取消</button>
      </div>
    </section>

    <section v-else-if="!panel && statusText" class="status-bubble" role="status">
      <span class="state-dot" :data-state="displayState" />
      <div>
        <strong>{{ statusText }}</strong>
        <small v-if="detail">{{ detail }}</small>
      </div>
    </section>

    <div class="pet-hit-area">
      <SpritePet
        v-if="renderedPetPack"
        :state="renderedPetState"
        :pack="renderedPetPack"
        @pet-pointer-down="onPetPointerDown"
        @pet-pointer-move="onPetPointerMove"
        @pet-pointer-up="onPetPointerUp"
        @pet-pointer-cancel="onPetPointerCancel"
        @pet-context-menu="onPetContextMenu"
      />
      <PetCanvas
        v-else
        :state="displayState"
        @pet-pointer-down="onPetPointerDown"
        @pet-pointer-move="onPetPointerMove"
        @pet-pointer-up="onPetPointerUp"
        @pet-pointer-cancel="onPetPointerCancel"
        @pet-context-menu="onPetContextMenu"
      />
    </div>
  </main>
</template>
