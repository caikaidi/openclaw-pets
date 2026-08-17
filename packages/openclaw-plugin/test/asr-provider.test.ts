import { describe, expect, it, vi } from "vitest";
import {
  BailianAsrProvider,
  createAsrProvider,
  FallbackAsrProvider,
  OpenAiCompatibleAsrProvider,
  WebhookAsrProvider,
  type AsrProvider,
  type AsrRequest,
} from "../src/asr-provider.js";

const sampleRequest: AsrRequest = {
  interactionId: "interaction-1",
  audio: Buffer.from("audio"),
  mimeType: "audio/webm;codecs=opus",
  durationMs: 1_200,
  vocabulary: ["VBG"],
  contextHints: [],
};

describe("ASR providers", () => {
  it("uses the verified Bailian Token Plan batch transcription contract", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      text: "完成了 VBG 温循测试。",
      request_id: "req-token-plan-1",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = new BailianAsrProvider({
      type: "bailian-token-plan",
      apiKey: "test-key",
      baseUrl: "https://token-plan.example",
      model: "qwen-audio-3.0-asr-flash",
    }, fetchImpl);

    await expect(provider.transcribe(sampleRequest)).resolves.toEqual({
      transcript: "完成了 VBG 温循测试。",
      provider: "bailian-token-plan",
      requestId: "req-token-plan-1",
    });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://token-plan.example/api/v1/services/aigc/multimodal-generation/generation");
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("qwen-audio-3.0-asr-flash");
    expect(body.input.messages[1].content[0]).toMatchObject({
      type: "input_audio",
      input_audio: { data: expect.stringMatching(/^data:audio\/webm;base64,/) },
    });
    expect(body.parameters).toEqual({ format: "webm" });
  });

  it.each([
    "请忠实转写语音。",
    "请如实转写语音内容。",
    "请忠实转写语音。专业词汇提示：VBG",
  ])("rejects a Bailian instruction echo instead of treating it as speech: %s", async (transcript) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      text: transcript,
      request_id: "req-silent-audio",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = new BailianAsrProvider({
      type: "bailian-token-plan",
      apiKey: "test-key",
      baseUrl: "https://token-plan.example",
      model: "qwen-audio-3.0-asr-flash",
    }, fetchImpl);

    await expect(provider.transcribe(sampleRequest)).rejects.toThrow("ASR provider returned no speech transcript");
  });

  it("uses the configured fallback only after the primary provider fails", async () => {
    const primary: AsrProvider = {
      type: "bailian-token-plan",
      transcribe: vi.fn(async () => { throw new Error("primary unavailable"); }),
    };
    const fallback: AsrProvider = {
      type: "dashscope",
      transcribe: vi.fn(async () => ({ transcript: "备用转写", provider: "dashscope" })),
    };
    const provider = new FallbackAsrProvider(primary, fallback);

    await expect(provider.transcribe(sampleRequest)).resolves.toEqual({
      transcript: "备用转写",
      provider: "dashscope",
      providerRole: "fallback",
    });
    expect(primary.transcribe).toHaveBeenCalledOnce();
    expect(fallback.transcribe).toHaveBeenCalledOnce();
  });

  it("distinguishes fallback use when both providers share the same type", async () => {
    const primary: AsrProvider = {
      type: "dashscope",
      transcribe: vi.fn(async () => { throw new Error("primary unavailable"); }),
    };
    const fallback: AsrProvider = {
      type: "dashscope",
      transcribe: vi.fn(async () => ({ transcript: "备用端点转写", provider: "dashscope" })),
    };

    await expect(new FallbackAsrProvider(primary, fallback).transcribe(sampleRequest)).resolves.toEqual({
      transcript: "备用端点转写",
      provider: "dashscope",
      providerRole: "fallback",
    });
  });

  it("does not activate a fallback without a configured primary", () => {
    expect(createAsrProvider(undefined, {
      type: "dashscope",
      apiKey: "test-key",
      baseUrl: "https://dashscope.aliyuncs.com",
      model: "qwen-audio-3.0-asr-flash",
    })).toBeUndefined();
  });

  it("supports an OpenAI-compatible batch transcription endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      text: "portable transcript",
    }), { status: 200, headers: { "content-type": "application/json", "x-request-id": "req-openai-1" } }));
    const provider = new OpenAiCompatibleAsrProvider({
      type: "openai-compatible",
      apiKey: "test-key",
      baseUrl: "https://asr.example/v1",
      model: "whisper-large-v3",
    }, fetchImpl);

    await expect(provider.transcribe(sampleRequest)).resolves.toEqual({
      transcript: "portable transcript",
      provider: "openai-compatible",
      requestId: "req-openai-1",
    });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://asr.example/v1/audio/transcriptions");
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get("model")).toBe("whisper-large-v3");
  });

  it("supports a language-neutral webhook provider contract", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      transcript: "webhook transcript",
      requestId: "req-webhook-1",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = new WebhookAsrProvider({
      type: "webhook",
      apiKey: "test-key",
      url: "https://asr.example/transcribe",
    }, fetchImpl);

    await expect(provider.transcribe(sampleRequest)).resolves.toEqual({
      transcript: "webhook transcript",
      provider: "webhook",
      requestId: "req-webhook-1",
    });
    const [, init] = fetchImpl.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      interactionId: "interaction-1",
      audio: { mimeType: "audio/webm;codecs=opus", data: expect.any(String) },
      durationMs: 1_200,
      vocabulary: ["VBG"],
    });
  });
});
