import { isLikelyAsrInstructionEcho, type AsrProviderType } from "@openclaw-pets/protocol";

export type AsrRequest = {
  interactionId: string;
  audio: Uint8Array;
  mimeType: string;
  durationMs: number;
  vocabulary: readonly string[];
  contextHints: readonly string[];
};

export type AsrResult = {
  transcript: string;
  provider: string;
  requestId?: string;
  providerRole?: "primary" | "fallback";
};

export interface AsrProvider {
  readonly type: AsrProviderType;
  transcribe(request: AsrRequest): Promise<AsrResult>;
}

export type BailianAsrConfig = {
  type: "bailian-token-plan" | "dashscope";
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type OpenAiCompatibleAsrConfig = {
  type: "openai-compatible";
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type WebhookAsrConfig = {
  type: "webhook";
  apiKey?: string;
  url: string;
};

export type AsrProviderConfig = BailianAsrConfig | OpenAiCompatibleAsrConfig | WebhookAsrConfig;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("ASR provider returned an invalid response");
  }
  return value as Record<string, unknown>;
}

function extractTranscript(payload: unknown): string {
  const root = record(payload);
  if (typeof root.text === "string" && root.text.trim()) return root.text.trim();
  const output = typeof root.output === "object" && root.output !== null ? record(root.output) : undefined;
  if (typeof output?.text === "string" && output.text.trim()) return output.text.trim();
  const choices = output?.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const message = record(record(choices[0]).message);
    const content = message.content;
    if (Array.isArray(content)) {
      for (const item of content) {
        const text = record(item).text;
        if (typeof text === "string" && text.trim()) return text.trim();
      }
    }
  }
  throw new Error("ASR provider returned no transcript");
}

function normalizedMimeType(mimeType: string): string {
  return (mimeType.split(";", 1)[0] ?? mimeType).trim().toLowerCase();
}

function asrFormat(mimeType: string): string {
  const formats: Record<string, string> = {
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
  };
  const normalized = normalizedMimeType(mimeType);
  return formats[normalized] ?? normalized.replace(/^audio\//u, "");
}

function requestId(response: Response, payload: unknown): string | undefined {
  const header = response.headers.get("x-request-id");
  if (header) return header;
  const value = record(payload).request_id;
  return typeof value === "string" && value ? value : undefined;
}

export class BailianAsrProvider implements AsrProvider {
  readonly type: BailianAsrConfig["type"];
  private readonly endpoint: string;

  constructor(
    private readonly config: BailianAsrConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.type = config.type;
    this.endpoint = `${config.baseUrl.replace(/\/$/u, "")}/api/v1/services/aigc/multimodal-generation/generation`;
  }

  async transcribe(request: AsrRequest): Promise<AsrResult> {
    const mimeType = normalizedMimeType(request.mimeType);
    const audioUrl = `data:${mimeType};base64,${Buffer.from(request.audio).toString("base64")}`;
    const vocabulary = request.vocabulary.length > 0
      ? `请忠实转写语音。专业词汇提示：${request.vocabulary.join("、")}`
      : "请忠实转写语音。";
    const prompt = request.contextHints.length > 0
      ? `${vocabulary}\n上下文判别规则：${request.contextHints.join(" ")}`
      : vocabulary;
    const tokenPlan = this.config.type === "bailian-token-plan";
    const audioContent = tokenPlan
      ? { type: "input_audio", input_audio: { data: audioUrl } }
      : { audio: audioUrl };
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.model,
        input: {
          messages: [
            { role: "system", content: [{ text: prompt }] },
            { role: "user", content: [audioContent] },
          ],
        },
        parameters: tokenPlan
          ? { format: asrFormat(mimeType) }
          : { asr_options: { language: "zh", enable_itn: true } },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`${this.type} ASR request failed (${response.status})`);
    const payload: unknown = await response.json();
    const id = requestId(response, payload);
    const transcript = extractTranscript(payload);
    if (isLikelyAsrInstructionEcho(transcript, prompt)) {
      throw new Error("ASR provider returned no speech transcript");
    }
    return {
      transcript,
      provider: this.type,
      ...(id ? { requestId: id } : {}),
    };
  }
}

export class OpenAiCompatibleAsrProvider implements AsrProvider {
  readonly type = "openai-compatible" as const;
  private readonly endpoint: string;

  constructor(
    private readonly config: OpenAiCompatibleAsrConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.endpoint = `${config.baseUrl.replace(/\/$/u, "")}/audio/transcriptions`;
  }

  async transcribe(request: AsrRequest): Promise<AsrResult> {
    const body = new FormData();
    const mimeType = normalizedMimeType(request.mimeType);
    body.set(
      "file",
      new Blob([Uint8Array.from(request.audio).buffer], { type: mimeType }),
      `recording.${asrFormat(mimeType)}`,
    );
    body.set("model", this.config.model);
    if (request.vocabulary.length > 0) body.set("prompt", request.vocabulary.join("、"));
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${this.config.apiKey}` },
      body,
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`${this.type} ASR request failed (${response.status})`);
    const payload: unknown = await response.json();
    const id = requestId(response, payload);
    return {
      transcript: extractTranscript(payload),
      provider: this.type,
      ...(id ? { requestId: id } : {}),
    };
  }
}

export class WebhookAsrProvider implements AsrProvider {
  readonly type = "webhook" as const;

  constructor(
    private readonly config: WebhookAsrConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async transcribe(request: AsrRequest): Promise<AsrResult> {
    const response = await this.fetchImpl(this.config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        interactionId: request.interactionId,
        audio: {
          mimeType: request.mimeType,
          data: Buffer.from(request.audio).toString("base64"),
        },
        durationMs: request.durationMs,
        vocabulary: request.vocabulary,
        contextHints: request.contextHints,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`${this.type} ASR request failed (${response.status})`);
    const payload = record(await response.json());
    const transcript = typeof payload.transcript === "string" ? payload.transcript.trim() : "";
    if (!transcript) throw new Error("webhook ASR returned no transcript");
    const id = typeof payload.requestId === "string" && payload.requestId
      ? payload.requestId
      : response.headers.get("x-request-id") ?? undefined;
    return {
      transcript,
      provider: this.type,
      ...(id ? { requestId: id } : {}),
    };
  }
}

export class FallbackAsrProvider implements AsrProvider {
  readonly type: AsrProviderType;

  constructor(
    private readonly primary: AsrProvider,
    private readonly fallback: AsrProvider,
  ) {
    this.type = primary.type;
  }

  async transcribe(request: AsrRequest): Promise<AsrResult> {
    try {
      return { ...await this.primary.transcribe(request), providerRole: "primary" };
    } catch (primaryError) {
      try {
        return { ...await this.fallback.transcribe(request), providerRole: "fallback" };
      } catch (fallbackError) {
        throw new AggregateError(
          [primaryError, fallbackError],
          `ASR failed on primary (${this.primary.type}) and fallback (${this.fallback.type})`,
        );
      }
    }
  }
}

export function createAsrProvider(
  primary: AsrProviderConfig | undefined,
  fallback: AsrProviderConfig | undefined,
  fetchImpl: typeof fetch = fetch,
): AsrProvider | undefined {
  const create = (config: AsrProviderConfig | undefined): AsrProvider | undefined => {
    if (!config) return undefined;
    if (config.type === "bailian-token-plan" || config.type === "dashscope") {
      return new BailianAsrProvider(config, fetchImpl);
    }
    if (config.type === "openai-compatible") return new OpenAiCompatibleAsrProvider(config, fetchImpl);
    if (config.type === "webhook") return new WebhookAsrProvider(config, fetchImpl);
    return undefined;
  };
  const primaryProvider = create(primary);
  if (!primaryProvider) return undefined;
  const fallbackProvider = create(fallback);
  return fallbackProvider
    ? new FallbackAsrProvider(primaryProvider, fallbackProvider)
    : primaryProvider;
}
