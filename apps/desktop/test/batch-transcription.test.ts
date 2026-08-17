import { describe, expect, it, vi } from "vitest";
import { transcribeRecording } from "../src/runtime/batch-transcription.js";

describe("desktop batch transcription", () => {
  it("submits one complete recording to the Pets plugin", async () => {
    const request = vi.fn(async () => ({
      interactionId: "interaction-1",
      transcript: "完成了温循测试",
      provider: "bailian-token-plan",
      requestId: "req-1",
    }));
    const result = await transcribeRecording(request, "interaction-1", {
      audioBase64: "YXVkaW8=",
      mimeType: "audio/webm;codecs=opus",
      durationMs: 1_200,
    });

    expect(result).toMatchObject({ transcript: "完成了温循测试", provider: "bailian-token-plan" });
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith("pets.transcription.create", {
      interactionId: "interaction-1",
      audioBase64: "YXVkaW8=",
      mimeType: "audio/webm;codecs=opus",
      durationMs: 1_200,
    }, { timeoutMs: 130_000 });
  });

  it("refuses an ASR instruction echo before it can reach the utterance router", async () => {
    const request = vi.fn(async () => ({
      interactionId: "interaction-silent",
      transcript: "请如实转写语音内容。",
      provider: "bailian-token-plan",
    }));

    await expect(transcribeRecording(request, "interaction-silent", {
      audioBase64: "c2lsZW5jZQ==",
      mimeType: "audio/webm;codecs=opus",
      durationMs: 1_200,
    })).rejects.toThrow("未检测到有效语音，请重试");
  });
});
