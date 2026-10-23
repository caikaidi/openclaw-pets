import { afterEach, describe, expect, it, vi } from "vitest";
import { BatchRecorder, type RecorderPort } from "../src/runtime/batch-recorder.js";

function fixture() {
  let now = 1000;
  const track = { readyState: "live", stop: vi.fn(() => { track.readyState = "ended"; }) };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const port: RecorderPort = {
    mimeType: "audio/webm", state: "inactive", onData() {}, onStop() {}, onError() {},
    start() { this.state = "recording"; },
    stop: vi.fn(function (this: RecorderPort) { this.state = "inactive"; }),
  };
  const recorder = new BatchRecorder({ getUserMedia: async () => stream, createRecorder: () => port, now: () => now });
  return { recorder, port, track, stream, advance: (ms: number) => { now += ms; } };
}
afterEach(() => vi.useRealTimers());

describe("authoritative recording controls", () => {
  it("recovers an empty recording and starts a fresh capture", async () => {
    const { recorder, port, track } = fixture();
    await recorder.start();
    const outcome = recorder.stop().catch((error: Error) => error.message);
    port.onStop();
    expect(await outcome).toContain("empty");
    expect(recorder.snapshot).toMatchObject({ phase: "error", released: true });
    await recorder.recover(); track.readyState = "live";
    await recorder.start();
    expect(recorder.snapshot.phase).toBe("recording");
    await recorder.recover();
  });

  it("settles every stop caller when recovery discards a pending stop", async () => {
    const { recorder } = fixture();
    await recorder.start();
    const outcomes = Promise.allSettled([recorder.stop(), recorder.stop()]);
    await recorder.recover();
    expect((await outcomes).map((item) => item.status)).toEqual(["rejected", "rejected"]);
    expect(recorder.snapshot).toMatchObject({ phase: "idle", released: true });
  });

  it("ignores late callbacks belonging to a recovered recorder", async () => {
    const { recorder, port, track } = fixture();
    await recorder.start();
    const lateStop = port.onStop; const lateError = port.onError;
    await recorder.recover();
    lateStop(); lateError(new Error("stale native event"));
    expect(recorder.snapshot).toMatchObject({ phase: "idle", released: true });
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it("retains release failure during finalization for explicit retry", async () => {
    const { recorder, port, track } = fixture();
    await recorder.start();
    track.stop.mockImplementationOnce(() => { throw new Error("release failed"); });
    const outcome = recorder.stop().catch((error: Error) => error.message);
    port.onData(new Blob(["audio"])); port.onStop();
    expect(await outcome).toContain("release failed");
    expect(recorder.snapshot).toMatchObject({ phase: "error", released: false });
    await recorder.recover();
    expect(recorder.snapshot).toMatchObject({ phase: "idle", released: true });
  });

  it("does not claim release when a track stop returns but remains live", async () => {
    const { recorder, port, track } = fixture();
    await recorder.start(); track.stop.mockImplementationOnce(() => undefined);
    port.onError(new Error("device failure"));
    expect(recorder.snapshot).toMatchObject({ phase: "error", released: false });
    await recorder.recover();
    expect(recorder.snapshot).toMatchObject({ phase: "idle", released: true });
  });

  it("returns to idle after cancellation meets a rejected permission request", async () => {
    let deny!: (error: Error) => void;
    const recorder = new BatchRecorder({ getUserMedia: () => new Promise((_resolve, reject) => { deny = reject; }) });
    const start = recorder.start().catch(() => undefined);
    const recovering = recorder.recover();
    deny(new Error("permission denied"));
    await Promise.all([start, recovering]);
    expect(recorder.snapshot).toMatchObject({ phase: "idle", released: true });
  });
  it("shares concurrent stops even after native state becomes inactive", async () => {
    const { recorder, port } = fixture();
    await recorder.start();
    const first = recorder.stop();
    const second = recorder.stop();
    const settled = Promise.allSettled([first, second]);
    port.onData(new Blob(["audio"])); port.onStop();
    expect((await settled).map((item) => item.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(port.stop).toHaveBeenCalledOnce();
  });

  it("shows stopping until track release, then freezes the capture duration", async () => {
    const { recorder, port, track, advance } = fixture();
    await recorder.start(); advance(2300);
    const stopping = recorder.stop();
    expect(recorder.snapshot).toMatchObject({ phase: "stopping", released: false, elapsedMs: 2300 });
    expect(track.stop).not.toHaveBeenCalled();
    port.onData(new Blob(["audio"])); port.onStop();
    await stopping; advance(5000);
    expect(recorder.snapshot).toMatchObject({ phase: "idle", released: true, elapsedMs: 2300 });
  });

  it("publishes asynchronous recording failure even without a stop caller", async () => {
    const { recorder, port, track } = fixture();
    await recorder.start(); port.onError(new Error("device lost"));
    expect(track.stop).toHaveBeenCalledOnce();
    expect(recorder.snapshot).toMatchObject({ phase: "error", released: true, error: "device lost" });
    await recorder.recover();
    expect(recorder.snapshot.phase).toBe("idle");
  });

  it("does not start capture when recovery cancels a pending permission request", async () => {
    const { stream, port, track } = fixture();
    const start = vi.spyOn(port, "start");
    let allow!: (value: MediaStream) => void;
    const recorder = new BatchRecorder({ getUserMedia: () => new Promise((resolve) => { allow = resolve; }), createRecorder: () => port });
    const pending = recorder.start();
    const rejected = pending.catch(() => undefined);
    const recovery = recorder.recover();
    allow(stream);
    await Promise.all([rejected, recovery]);
    expect(start).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(recorder.snapshot).toMatchObject({ phase: "idle", released: true });
  });

  it("retains an unreleased track for retry instead of falsely claiming stopped", async () => {
    const { recorder, port, track } = fixture();
    track.stop.mockImplementationOnce(() => { throw new Error("release failed"); });
    await recorder.start(); port.onError(new Error("device lost"));
    expect(recorder.snapshot).toMatchObject({ phase: "error", released: false });
    await recorder.recover();
    expect(track.stop).toHaveBeenCalledTimes(2);
    expect(recorder.snapshot).toMatchObject({ phase: "idle", released: true });
  });

  it("recovers a missing stop event after a bounded wait", async () => {
    vi.useFakeTimers();
    const { recorder, track } = fixture();
    await recorder.start();
    const outcome = recorder.stop().catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(6000);
    expect(await outcome).toMatch(/stop|停止/i);
    expect(track.stop).toHaveBeenCalledOnce();
    expect(recorder.snapshot).toMatchObject({ phase: "error", released: true });
  });

  it("cancels stop-during-start without briefly starting the native recorder", async () => {
    const { stream, port, track } = fixture();
    const start = vi.spyOn(port, "start");
    let allow!: (value: MediaStream) => void;
    const recorder = new BatchRecorder({ getUserMedia: () => new Promise((resolve) => { allow = resolve; }), createRecorder: () => port });
    const starting = recorder.start().catch((error: Error) => error.message);
    const stopping = recorder.stop().catch((error: Error) => error.message);
    allow(stream);
    expect(await starting).toContain("cancelled");
    expect(await stopping).toContain("cancelled");
    expect(start).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(recorder.snapshot).toMatchObject({ phase: "idle", released: true });
  });

  it("rejects pending stop on recovery and ignores late native callbacks", async () => {
    const { recorder, port, track } = fixture();
    await recorder.start();
    const lateStop = port.onStop;
    const lateError = port.onError;
    const result = recorder.stop().catch((error: Error) => error.message);
    await recorder.recover();
    lateStop(); lateError(new Error("late device failure"));
    expect(await result).toContain("discarded");
    expect(track.stop).toHaveBeenCalledOnce();
    expect(recorder.snapshot).toMatchObject({ phase: "idle", released: true });
  });

  it("publishes spontaneous native stop as an error, not a phantom recording", async () => {
    const { recorder, port } = fixture();
    const phases: string[] = [];
    const unsubscribe = recorder.subscribe((snapshot) => phases.push(snapshot.phase));
    await recorder.start(); port.onStop();
    expect(phases).toEqual(["idle", "starting", "recording", "error"]);
    expect(recorder.snapshot.released).toBe(true);
    unsubscribe();
  });

  it("releases empty recordings and requires explicit recovery", async () => {
    const { recorder, port } = fixture();
    await recorder.start();
    const result = recorder.stop().catch((error: Error) => error.message);
    port.onStop();
    expect(await result).toContain("empty");
    expect(recorder.snapshot).toMatchObject({ phase: "error", released: true });
    await expect(recorder.start()).rejects.toThrow("recover");
    await recorder.recover();
    expect(recorder.snapshot.phase).toBe("idle");
  });

  it("reports denied permission without claiming capture or silently retrying", async () => {
    const media = vi.fn(async () => { throw new Error("permission denied"); });
    const recorder = new BatchRecorder({ getUserMedia: media });
    await expect(recorder.start()).rejects.toThrow("denied");
    expect(recorder.snapshot).toMatchObject({ phase: "error", released: true, elapsedMs: 0 });
    await recorder.recover();
    expect(media).toHaveBeenCalledOnce();
  });

  it("handles 30 deterministic rapid concurrent stop pairs without double release", async () => {
    for (let cycle = 0; cycle < 30; cycle++) {
      const { recorder, port, track } = fixture();
      await recorder.start();
      const first = recorder.stop(); const second = recorder.stop();
      expect(first).toBe(second);
      port.onData(new Blob(["audio"])); port.onStop();
      await Promise.all([first, second]);
      expect(track.stop).toHaveBeenCalledOnce();
    }
  });
});
