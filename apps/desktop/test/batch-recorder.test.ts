import { describe, expect, it, vi } from "vitest";
import { BatchRecorder, type RecorderPort } from "../src/runtime/batch-recorder.js";

describe("BatchRecorder", () => {
  it("returns one complete compressed recording only after the user stops", async () => {
    const stopTrack = vi.fn();
    let recorderPort: RecorderPort | undefined;
    const recorder = new BatchRecorder({
      getUserMedia: async () => ({ getTracks: () => [{ stop: stopTrack }] }) as unknown as MediaStream,
      createRecorder: () => {
        recorderPort = {
          mimeType: "audio/webm;codecs=opus",
          state: "inactive",
          onData: () => undefined,
          onStop: () => undefined,
          onError: () => undefined,
          start() { this.state = "recording"; },
          stop() {
            this.state = "inactive";
            this.onData(new Blob([Buffer.from("complete-audio")], { type: this.mimeType }));
            this.onStop();
          },
        };
        return recorderPort;
      },
      now: vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(2_250),
    });

    await recorder.start();
    expect(recorder.recording).toBe(true);
    const result = await recorder.stop();

    expect(result).toEqual({
      audioBase64: Buffer.from("complete-audio").toString("base64"),
      mimeType: "audio/webm;codecs=opus",
      durationMs: 1_250,
    });
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(recorder.recording).toBe(false);
  });

  it("rejects a second start while microphone permission is still pending", async () => {
    let resolveStream: ((stream: MediaStream) => void) | undefined;
    const streamPromise = new Promise<MediaStream>((resolve) => { resolveStream = resolve; });
    const recorder = new BatchRecorder({
      getUserMedia: () => streamPromise,
      createRecorder: () => ({
        mimeType: "audio/webm",
        state: "inactive",
        onData: () => undefined,
        onStop: () => undefined,
        onError: () => undefined,
        start() { this.state = "recording"; },
        stop() { this.state = "inactive"; },
      }),
    });

    const firstStart = recorder.start();
    await expect(recorder.start()).rejects.toThrow("initialization");
    resolveStream?.({ getTracks: () => [] } as unknown as MediaStream);
    await firstStart;
  });

  it("releases the microphone if recorder initialization fails", async () => {
    const stopTrack = vi.fn();
    const recorder = new BatchRecorder({
      getUserMedia: async () => ({ getTracks: () => [{ stop: stopTrack }] }) as unknown as MediaStream,
      createRecorder: () => { throw new Error("unsupported recorder"); },
    });

    await expect(recorder.start()).rejects.toThrow("unsupported recorder");
    expect(stopTrack).toHaveBeenCalledOnce();
  });

  it("releases the microphone if recorder stop throws synchronously", async () => {
    const stopTrack = vi.fn();
    const recorder = new BatchRecorder({
      getUserMedia: async () => ({ getTracks: () => [{ stop: stopTrack }] }) as unknown as MediaStream,
      createRecorder: () => ({
        mimeType: "audio/webm",
        state: "inactive",
        onData: () => undefined,
        onStop: () => undefined,
        onError: () => undefined,
        start() { this.state = "recording"; },
        stop() { throw new Error("native stop failed"); },
      }),
    });

    await recorder.start();
    const stopped = recorder.stop();

    await expect(stopped).rejects.toThrow("native stop failed");
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(recorder.recording).toBe(false);
  });
});
