import type {
  AsrProviderConfig,
} from "./asr-provider.js";

export type PetsPluginConfig = {
  storagePath: string;
  journal: {
    provider: "local" | "http";
    http?: {
      baseUrl: string;
      apiKey?: string;
      timeoutMs: number;
    };
  };
  contextInjection: {
    enabled: boolean;
    maxItems: number;
  };
  routing: {
    contextPrefixes: string[];
    agentPrefixes: string[];
    targetAgentId?: string;
    classifier: {
      enabled: boolean;
      model?: string;
      timeoutMs: number;
    };
  };
  asr: {
    maxAudioBytes: number;
    maxDurationMs: number;
    vocabulary: string[];
    contextHints: string[];
    primary?: AsrProviderConfig;
    fallback?: AsrProviderConfig;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function boundedStrings(value: unknown, maxItems: number, maxLength: number): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim().slice(0, maxLength))
      .slice(0, maxItems)
    : [];
}

function providerConfig(value: unknown): AsrProviderConfig | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined;
  const apiKey = typeof value.apiKey === "string" && value.apiKey.trim() ? value.apiKey : undefined;
  if (value.type === "bailian-token-plan" || value.type === "dashscope") {
    if (!apiKey) return undefined;
    return {
      type: value.type,
      apiKey,
      baseUrl: typeof value.baseUrl === "string" && value.baseUrl.trim()
        ? value.baseUrl.trim()
        : value.type === "bailian-token-plan"
          ? "https://token-plan.cn-beijing.maas.aliyuncs.com"
          : "https://dashscope.aliyuncs.com",
      model: typeof value.model === "string" && value.model.trim()
        ? value.model.trim()
        : "qwen-audio-3.0-asr-flash",
    };
  }
  if (value.type === "openai-compatible") {
    if (!apiKey || typeof value.baseUrl !== "string" || !value.baseUrl.trim()) return undefined;
    return {
      type: value.type,
      apiKey,
      baseUrl: value.baseUrl.trim(),
      model: typeof value.model === "string" && value.model.trim() ? value.model.trim() : "whisper-1",
    };
  }
  if (value.type === "webhook" && typeof value.url === "string" && value.url.trim()) {
    return {
      type: value.type,
      url: value.url.trim(),
      ...(apiKey ? { apiKey } : {}),
    };
  }
  return undefined;
}

export function resolveConfig(value: unknown): PetsPluginConfig {
  const config = isRecord(value) ? value : {};
  const context = isRecord(config.contextInjection) ? config.contextInjection : {};
  const routing = isRecord(config.routing) ? config.routing : {};
  const classifier = isRecord(routing.classifier) ? routing.classifier : {};
  const asr = isRecord(config.asr) ? config.asr : {};
  const journal = isRecord(config.journal) ? config.journal : {};
  const journalHttp = isRecord(journal.http) ? journal.http : {};
  const prefixes = (value: unknown): string[] => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim().slice(0, 80))
      .slice(0, 50)
    : [];
  const configuredPrimary = providerConfig(asr.primary);
  const configuredFallback = configuredPrimary ? providerConfig(asr.fallback) : undefined;
  return {
    storagePath: typeof config.storagePath === "string" && config.storagePath.trim()
      ? config.storagePath
      : "~/.openclaw/openclaw-pets",
    journal: journal.provider === "http" && typeof journalHttp.baseUrl === "string" && journalHttp.baseUrl.trim()
      ? {
          provider: "http",
          http: {
            baseUrl: journalHttp.baseUrl.trim().replace(/\/+$/u, ""),
            ...(typeof journalHttp.apiKey === "string" && journalHttp.apiKey.trim()
              ? { apiKey: journalHttp.apiKey }
              : {}),
            timeoutMs: boundedInteger(journalHttp.timeoutMs, 8_000, 1_000, 30_000),
          },
        }
      : { provider: "local" },
    contextInjection: {
      enabled: context.enabled === true,
      maxItems: typeof context.maxItems === "number" && Number.isInteger(context.maxItems)
        ? Math.min(10, Math.max(1, context.maxItems))
        : 3,
    },
    routing: {
      contextPrefixes: prefixes(routing.contextPrefixes),
      agentPrefixes: prefixes(routing.agentPrefixes),
      ...(typeof routing.targetAgentId === "string" && routing.targetAgentId.trim()
        ? { targetAgentId: routing.targetAgentId.trim().slice(0, 128) }
        : {}),
      classifier: {
        enabled: classifier.enabled !== false,
        ...(typeof classifier.model === "string" && classifier.model.trim()
          ? { model: classifier.model.trim().slice(0, 256) }
          : {}),
        timeoutMs: boundedInteger(classifier.timeoutMs, 6_000, 500, 30_000),
      },
    },
    asr: {
      maxAudioBytes: boundedInteger(asr.maxAudioBytes, 10 * 1024 * 1024, 1, 10 * 1024 * 1024),
      maxDurationMs: boundedInteger(asr.maxDurationMs, 120_000, 1_000, 120_000),
      vocabulary: boundedStrings(asr.vocabulary, 100, 80),
      contextHints: boundedStrings(asr.contextHints, 20, 500),
      ...(configuredPrimary ? { primary: configuredPrimary } : {}),
      ...(configuredFallback ? { fallback: configuredFallback } : {}),
    },
  };
}
