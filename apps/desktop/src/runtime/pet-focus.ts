type FocusPort = {
  dom: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  initial(): boolean;
  query(): Promise<boolean>;
  subscribe(listener: (focused: boolean) => void): Promise<() => void>;
  transitioning(): boolean;
};

export function observePetFocus(port: FocusPort, change: (focused: boolean) => void): () => void {
  let disposed = false;
  let revision = 0;
  let unlisten: (() => void) | undefined;
  let focused = port.initial();
  change(focused);
  const accept = (value: boolean): void => {
    if (disposed || port.transitioning()) return;
    revision++;
    if (value !== focused) { focused = value; change(value); }
  };
  const focus = (): void => accept(true);
  const blur = (): void => accept(false);
  port.dom.addEventListener?.("focus", focus);
  port.dom.addEventListener?.("blur", blur);
  void port.subscribe(accept).then((stop) => { if (disposed) stop(); else unlisten = stop; }).catch(() => undefined);
  const initialRevision = revision;
  void port.query().then((value) => { if (revision === initialRevision) accept(value); }).catch(() => undefined);
  return () => {
    disposed = true;
    port.dom.removeEventListener?.("focus", focus);
    port.dom.removeEventListener?.("blur", blur);
    unlisten?.();
  };
}

/** Only the visual timeline stops; no task/capture clock uses this class. */
export class AnimationClock {
  private elapsed = 0;
  private previous: number | undefined;
  private paused = false;
  tick(now: number): number {
    if (!this.paused) {
      if (this.previous !== undefined) this.elapsed += now - this.previous;
      this.previous = now;
    }
    return this.elapsed;
  }
  pause(): void { this.paused = true; this.previous = undefined; }
  resume(): void { this.paused = false; this.previous = undefined; }
  reset(): void { this.elapsed = 0; this.previous = undefined; }
}
