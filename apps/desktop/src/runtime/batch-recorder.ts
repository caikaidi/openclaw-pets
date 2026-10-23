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

export type RecorderSnapshot = {
  phase: "idle" | "starting" | "recording" | "stopping" | "error";
  released: boolean;
  elapsedMs: number;
  error?: string;
};

export class BatchRecorder {
  private readonly dependencies: BatchRecorderDependencies;
  private stream: MediaStream | undefined;
  private recorder: RecorderPort | undefined;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private elapsedMs = 0;
  private phase: RecorderSnapshot["phase"] = "idle";
  private error: string | undefined;
  private starting = false;
  private cancelled = false;
  private startPromise: Promise<void> | undefined;
  private stopPromise: Promise<RecordedAudio> | undefined;
  private resolveStop: ((result: RecordedAudio) => void) | undefined;
  private rejectStop: ((error: Error) => void) | undefined;
  private stopTimer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<(snapshot: RecorderSnapshot) => void>();

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
    return this.phase === "recording" || (this.phase === "stopping" && Boolean(this.recorder));
  }

  get snapshot(): RecorderSnapshot {
    return {
      phase: this.phase,
      released: !this.stream && !this.starting,
      elapsedMs: this.recording ? Math.max(0, this.dependencies.now() - this.startedAt) : this.elapsedMs,
      ...(this.error ? { error: this.error } : {}),
    };
  }

  subscribe(listener: (snapshot: RecorderSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => { this.listeners.delete(listener); };
  }

  private publish(): void {
    for (const listener of this.listeners) listener(this.snapshot);
  }

  start(): Promise<void> {
    if (this.starting) return Promise.reject(new Error("Recording initialization is already active"));
    if (this.phase !== "idle" || this.stopPromise) return Promise.reject(new Error("A recording is already active; recover before restarting"));
    this.starting = true;
    this.cancelled = false;
    this.phase = "starting";
    this.error = undefined;
    this.elapsedMs = 0;
    this.publish();
    this.startPromise = this.initialize();
    return this.startPromise;
  }

  private async initialize(): Promise<void> {
    try {
      this.stream = await this.dependencies.getUserMedia();
      if (this.cancelled) {
        if (!this.releaseTracks()) throw new Error("Microphone release failed; retry recovery");
        this.phase = "idle";
        throw new Error("Recording initialization cancelled");
      }
      const recorder = this.dependencies.createRecorder(this.stream);
      this.recorder = recorder;
      this.chunks = [];
      this.startedAt = this.dependencies.now();
      recorder.onData = (blob) => {
        if (this.recorder === recorder && blob.size > 0) this.chunks.push(blob);
      };
      recorder.onStop = () => {
        if (this.recorder !== recorder) return;
        if (this.phase === "stopping") void this.finalize();
        else this.fail(new Error("Microphone recording ended unexpectedly"));
      };
      recorder.onError = (error) => { if (this.recorder === recorder) this.fail(error); };
      recorder.start();
      if (this.phase === "error") throw new Error(this.error);
      this.phase = "recording";
    } catch (cause) {
      if (this.phase !== "idle") this.fail(cause instanceof Error ? cause : new Error("Microphone initialization failed"));
      throw cause;
    } finally {
      this.starting = false;
      this.publish();
    }
  }

  stop(): Promise<RecordedAudio> {
    // Native state turns inactive before the data/stop events arrive.
    if (this.stopPromise) return this.stopPromise;
    if (this.starting) return this.recover().then(() => { throw new Error("Recording initialization cancelled"); });
    const recorder = this.recorder;
    if (!recorder || this.phase !== "recording") return Promise.reject(new Error("No recording is active"));
    const pending = new Promise<RecordedAudio>((resolve, reject) => {
      this.resolveStop = resolve;
      this.rejectStop = reject;
    });
    this.stopPromise = pending;
    this.phase = "stopping";
    this.publish();
    this.stopTimer = setTimeout(() => this.fail(new Error("Microphone stop timed out; recording discarded")), 5000);
    try { recorder.stop(); }
    catch (cause) { this.fail(cause instanceof Error ? cause : new Error("Microphone recording could not stop")); }
    return pending;
  }

  private async finalize(): Promise<void> {
    const resolve = this.resolveStop;
    const reject = this.rejectStop;
    try {
      const durationMs = Math.max(1, Math.round(this.dependencies.now() - this.startedAt));
      this.elapsedMs = durationMs;
      const blob = new Blob(this.chunks, { type: this.recorder?.mimeType || "audio/webm" });
      // Encoding is not microphone ownership. Release before any await.
      if (!this.releaseTracks()) throw new Error("Microphone release failed; retry recovery");
      this.detachRecorder();
      this.publish();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (this.resolveStop !== resolve) return;
      if (bytes.length === 0) throw new Error("The recording was empty");
      this.clearStop();
      this.phase = "idle";
      this.publish();
      resolve?.({ audioBase64: bytesToBase64(bytes), mimeType: blob.type || "audio/webm", durationMs });
    } catch (cause) {
      if (this.resolveStop !== resolve) return;
      const error = cause instanceof Error ? cause : new Error("Recording finalization failed");
      this.error = error.message;
      this.phase = "error";
      this.detachRecorder();
      this.clearStop();
      this.publish();
      reject?.(error);
    }
  }

  private fail(error: Error): void {
    const reject = this.rejectStop;
    if (this.recording) this.elapsedMs = Math.max(0, this.dependencies.now() - this.startedAt);
    const released = this.releaseTracks();
    this.detachRecorder();
    this.clearStop();
    this.phase = "error";
    this.error = `${error.message}${released ? "" : "; microphone release unconfirmed"}`;
    this.publish();
    reject?.(error);
  }

  private releaseTracks(): boolean {
    let released = true;
    for (const track of this.stream?.getTracks() ?? []) {
      try {
        if (track.readyState !== "ended") track.stop();
        if (track.readyState === "live") released = false;
      } catch { released = false; }
    }
    if (released) this.stream = undefined;
    return released;
  }

  private detachRecorder(): void {
    if (this.recorder) {
      this.recorder.onData = () => undefined;
      this.recorder.onStop = () => undefined;
      this.recorder.onError = () => undefined;
    }
    this.recorder = undefined;
    this.chunks = [];
  }

  private clearStop(): void {
    if (this.stopTimer !== undefined) clearTimeout(this.stopTimer);
    this.stopTimer = undefined;
    this.stopPromise = undefined;
    this.resolveStop = undefined;
    this.rejectStop = undefined;
  }

  async recover(): Promise<void> {
    this.cancelled = true;
    if (this.starting) {
      this.phase = "stopping";
      this.publish();
      await this.startPromise?.catch(() => undefined);
    }
    const reject = this.rejectStop;
    if (this.recording) this.elapsedMs = Math.max(0, this.dependencies.now() - this.startedAt);
    const released = this.releaseTracks();
    this.detachRecorder();
    this.clearStop();
    this.phase = released ? "idle" : "error";
    this.error = released ? undefined : "Microphone release failed; retry recovery";
    this.publish();
    reject?.(new Error("Recording discarded during recovery"));
  }
}
