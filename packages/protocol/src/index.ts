export const PETS_PROTOCOL_VERSION = 4 as const;
export const PETS_PLUGIN_ID = "openclaw-pets" as const;

export const PETS_RPC = {
  capabilities: "pets.capabilities",
  status: "pets.status",
  activityAppend: "pets.activity.append",
  activityUpdate: "pets.activity.update",
  activityList: "pets.activity.list",
  activityDelete: "pets.activity.delete",
  todoGenerate: "pets.todo.generate",
  transcriptionCreate: "pets.transcription.create",
  utteranceRoute: "pets.utterance.route",
  contextPreview: "pets.context.preview",
  captureSet: "pets.capture.set",
} as const;

// Plugin service emitters receive the unqualified event name. OpenClaw adds
// `plugin.<plugin-id>.` before broadcasting it to Gateway clients.
export const PETS_PLUGIN_EVENT = {
  changed: "changed",
} as const;

export const PETS_EVENT = {
  changed: `plugin.${PETS_PLUGIN_ID}.${PETS_PLUGIN_EVENT.changed}`,
} as const;

export const PET_SEMANTIC_STATES = [
  "offline",
  "idle",
  "listening",
  "transcribing",
  "thinking",
  "working",
  "needs_input",
  "speaking",
  "succeeded",
  "failed",
] as const;

export type PetSemanticState = (typeof PET_SEMANTIC_STATES)[number];

export type PetStatus = {
  protocolVersion: typeof PETS_PROTOCOL_VERSION;
  revision: number;
  state: PetSemanticState;
  changedAt: string;
  sessionKey?: string;
  runId?: string;
  detail?: string;
  interactionId?: string;
};

export const ASR_PROVIDER_TYPES = [
  "bailian-token-plan",
  "dashscope",
  "openai-compatible",
  "webhook",
] as const;
export type AsrProviderType = (typeof ASR_PROVIDER_TYPES)[number];

export const ASR_HEALTH_STATES = [
  "unconfigured",
  "configured",
  "healthy",
  "degraded",
  "unavailable",
] as const;
export type AsrHealth = (typeof ASR_HEALTH_STATES)[number];

export type AsrCapability = {
  available: boolean;
  health: AsrHealth;
  primary?: AsrProviderType;
  fallback?: AsrProviderType;
};

export type TranscriptionRequest = {
  interactionId: string;
  audioBase64: string;
  mimeType: string;
  durationMs: number;
};

export type TranscriptionResult = {
  interactionId: string;
  transcript: string;
  provider: string;
  requestId?: string;
};

function normalizedAsrInstruction(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s，。！？：:；;、,.!?"'“”‘’（）()[\]【】]/gu, "");
}

export function isLikelyAsrInstructionEcho(transcript: string, prompt?: string): boolean {
  const normalized = normalizedAsrInstruction(transcript);
  if (!normalized) return false;
  if (prompt && normalized === normalizedAsrInstruction(prompt)) return true;
  const knownEmptyAudioEchoes = new Set([
    "请忠实转写语音",
    "请忠实转写语音内容",
    "请如实转写语音",
    "请如实转写语音内容",
    "请如实转写音频",
    "请如实转写音频内容",
  ]);
  if (knownEmptyAudioEchoes.has(normalized)) return true;
  return (normalized.startsWith("请忠实转写语音") || normalized.startsWith("请如实转写语音"))
    && (normalized.includes("专业词汇提示") || normalized.includes("上下文判别规则"));
}

export const ACTIVITY_SOURCES = ["voice", "text", "desktop", "import"] as const;
export type ActivitySource = string;

export const JOURNAL_STATUSES = ["ok", "partial", "unavailable"] as const;
export type JournalStatus = (typeof JOURNAL_STATUSES)[number];

export type JournalGap = {
  source: string;
  reason: string;
};

export type ActivityObservation = {
  id: string;
  occurredAt: string;
  source: ActivitySource;
  text: string;
  tags?: string[];
  agentId?: string;
  sessionKey?: string;
  interactionId?: string;
  asrProvider?: string;
  asrRequestId?: string;
  route?: UtteranceRoute;
  editedAt?: string;
  revision?: string;
};

export type JournalUpdateRequest = {
  id: string;
  text: string;
  expectedRevision: string;
};

export type JournalUpdateResult =
  | { status: "updated" | "conflict"; observation: ActivityObservation }
  | { status: "not_found" };

export type ActivityPage = {
  status: JournalStatus;
  observations: ActivityObservation[];
  gaps: JournalGap[];
  nextCursor?: string;
};

export type TodoItem = {
  id: string;
  title: string;
  notes?: string;
  dueAt?: string;
  sourceObservationIds: string[];
};

export type TodoSummary = {
  status: JournalStatus;
  generatedAt: string;
  observationsRead: number;
  todos: TodoItem[];
  gaps: JournalGap[];
};

export const UTTERANCE_ROUTES = ["context", "agent", "confirm"] as const;
export type UtteranceRoute = (typeof UTTERANCE_ROUTES)[number];

export type UtteranceRouteRequest = {
  text: string;
  requestedRoute?: UtteranceRoute;
};

export type UtteranceRouteResult = {
  route: UtteranceRoute;
  text: string;
  matchedPrefix?: string;
  targetAgentId?: string;
};

const observationKeys = new Set([
  "id",
  "occurredAt",
  "source",
  "text",
  "tags",
  "agentId",
  "sessionKey",
  "interactionId",
  "asrProvider",
  "asrRequestId",
  "route",
  "editedAt",
  "revision",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

export function isPetSemanticState(value: unknown): value is PetSemanticState {
  return typeof value === "string" && (PET_SEMANTIC_STATES as readonly string[]).includes(value);
}

export function isActivityObservation(value: unknown): value is ActivityObservation {
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((key) => !observationKeys.has(key))) return false;
  if (!isBoundedString(value.id, 128) || value.id !== value.id.trim()) return false;
  if (!isBoundedString(value.occurredAt, 64) || !Number.isFinite(Date.parse(value.occurredAt))) return false;
  if (!isBoundedString(value.source, 64) || value.source !== value.source.trim()) return false;
  if (!isBoundedString(value.text, 8_000)) return false;
  if (value.agentId !== undefined && !isBoundedString(value.agentId, 128)) return false;
  if (value.sessionKey !== undefined && !isBoundedString(value.sessionKey, 512)) return false;
  if (value.interactionId !== undefined && !isBoundedString(value.interactionId, 128)) return false;
  if (value.asrProvider !== undefined && !isBoundedString(value.asrProvider, 128)) return false;
  if (value.asrRequestId !== undefined && !isBoundedString(value.asrRequestId, 256)) return false;
  if (value.route !== undefined && !(UTTERANCE_ROUTES as readonly unknown[]).includes(value.route)) return false;
  if (value.editedAt !== undefined
    && (!isBoundedString(value.editedAt, 64) || !Number.isFinite(Date.parse(value.editedAt)))) return false;
  if (value.revision !== undefined && !isBoundedString(value.revision, 128)) return false;
  if (value.tags !== undefined) {
    if (!Array.isArray(value.tags) || value.tags.length > 20) return false;
    if (value.tags.some((tag) => !isBoundedString(tag, 64))) return false;
  }
  return true;
}
