export type RecordedAudio = {
  audioBase64: string;
  mimeType: string;
  durationMs: number;
};

export type RecorderPort = {
  mimeType: string;
  state: "inactive" | "recording" | "paused";
  onData(blob: Blob): void;
  onStop(): void;
  onError(error: Error): void;
  start(): void;
  stop(): void;
};

type BatchRecorderDependencies = {
  getUserMedia: () => Promise<MediaStream>;
  createRecorder: (stream: MediaStream) => RecorderPort;
  now: () => number;
};

const supportedMimeTypes = [
  "audio/webm;codecs=opus",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

function browserRecorder(stream: MediaStream): RecorderPort {
  const mimeType = supportedMimeTypes.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  const native = mimeType
    ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64_000 })
    : new MediaRecorder(stream, { audioBitsPerSecond: 64_000 });
  const port: RecorderPort = {
    get mimeType() { return native.mimeType || mimeType || "audio/webm"; },
    get state() { return native.state; },
    onData: () => undefined,
    onStop: () => undefined,
    onError: () => undefined,
    start: () => native.start(),
    stop: () => native.stop(),
  };
  native.addEventListener("dataavailable", (event) => port.onData(event.data));
  native.addEventListener("stop", () => port.onStop());
  native.addEventListener("error", () => port.onError(new Error("Microphone recording failed")));
  return port;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 16_384;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export class BatchRecorder {
  private readonly dependencies: BatchRecorderDependencies;
  private stream: MediaStream | undefined;
  private recorder: RecorderPort | undefined;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private starting = false;
  private stopPromise: Promise<RecordedAudio> | undefined;
  private resolveStop: ((result: RecordedAudio) => void) | undefined;
  private rejectStop: ((error: Error) => void) | undefined;

  constructor(dependencies: Partial<BatchRecorderDependencies> = {}) {
    this.dependencies = {
      getUserMedia: dependencies.getUserMedia ?? (() => navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })),
      createRecorder: dependencies.createRecorder ?? browserRecorder,
      now: dependencies.now ?? (() => performance.now()),
    };
  }

  get recording(): boolean {
    return this.recorder?.state === "recording";
  }

  async start(): Promise<void> {
    if (this.recorder) throw new Error("A recording is already active");
    if (this.starting) throw new Error("Recording initialization is already active");
    this.starting = true;
    let stream: MediaStream | undefined;
    try {
      stream = await this.dependencies.getUserMedia();
      this.stream = stream;
      const recorder = this.dependencies.createRecorder(stream);
      this.recorder = recorder;
      this.chunks = [];
      this.startedAt = this.dependencies.now();
      recorder.onData = (blob) => {
        if (blob.size > 0) this.chunks.push(blob);
      };
      recorder.onStop = () => void this.finalize();
      recorder.onError = (error) => this.fail(error);
      recorder.start();
    } catch (cause) {
      for (const track of stream?.getTracks() ?? []) track.stop();
      this.stream = undefined;
      this.recorder = undefined;
      this.chunks = [];
      throw cause;
    } finally {
      this.starting = false;
    }
  }

  stop(): Promise<RecordedAudio> {
    const recorder = this.recorder;
    if (!recorder || recorder.state !== "recording") {
      return Promise.reject(new Error("No recording is active"));
    }
    let pending = this.stopPromise;
    if (!pending) {
      pending = new Promise<RecordedAudio>((resolve, reject) => {
        this.resolveStop = resolve;
        this.rejectStop = reject;
      });
      this.stopPromise = pending;
      try {
        recorder.stop();
      } catch (cause) {
        this.rejectStop?.(cause instanceof Error ? cause : new Error("Microphone recording could not stop"));
        this.cleanup();
      }
    }
    return pending;
  }

  private async finalize(): Promise<void> {
    try {
      const recorder = this.recorder;
      const durationMs = Math.max(1, Math.round(this.dependencies.now() - this.startedAt));
      const blob = new Blob(this.chunks, { type: recorder?.mimeType || "audio/webm" });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.length === 0) throw new Error("The recording was empty");
      this.resolveStop?.({
        audioBase64: bytesToBase64(bytes),
        mimeType: blob.type || "audio/webm",
        durationMs,
      });
    } catch (cause) {
      this.rejectStop?.(cause instanceof Error ? cause : new Error("Recording finalization failed"));
    } finally {
      this.cleanup();
    }
  }

  private fail(error: Error): void {
    this.rejectStop?.(error);
    this.cleanup();
  }

  private cleanup(): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = undefined;
    this.recorder = undefined;
    this.chunks = [];
    this.stopPromise = undefined;
    this.resolveStop = undefined;
    this.rejectStop = undefined;
  }
}
