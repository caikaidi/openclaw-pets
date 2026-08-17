import { PETS_RPC, isLikelyAsrInstructionEcho, type TranscriptionResult } from "@openclaw-pets/protocol";
import type { RecordedAudio } from "./batch-recorder.js";

type GatewayRequest = <T>(
  method: string,
  params: Record<string, unknown>,
  options?: { timeoutMs?: number | null },
) => Promise<T>;

export async function transcribeRecording(
  request: GatewayRequest,
  interactionId: string,
  recording: RecordedAudio,
): Promise<TranscriptionResult> {
  const result = await request<TranscriptionResult>(PETS_RPC.transcriptionCreate, {
    interactionId,
    ...recording,
  }, { timeoutMs: 130_000 });
  if (result.interactionId !== interactionId || typeof result.transcript !== "string" || !result.transcript.trim()
    || typeof result.provider !== "string" || !result.provider.trim()) {
    throw new Error("OpenClaw Pets returned an invalid transcription result");
  }
  if (isLikelyAsrInstructionEcho(result.transcript)) {
    throw new Error("未检测到有效语音，请重试");
  }
  return { ...result, transcript: result.transcript.trim() };
}
