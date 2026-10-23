type EditKey = Pick<KeyboardEvent, "key" | "keyCode" | "shiftKey" | "isComposing" | "repeat" | "preventDefault">;

/** WebKit can finish composition before delivering the confirming Enter. */
export class EditKeyboard {
  private composing = false;
  private endedAt = -Infinity;
  private enterHeld = false;
  private lastCompositionKey: string | undefined;
  constructor(private now: () => number = () => performance.now()) {}
  compositionStart(): void { this.composing = true; this.lastCompositionKey = undefined; this.endedAt = -Infinity; }
  compositionEnd(): void {
    this.composing = false;
    // Space/digit candidate selection is distinguishable from Enter. With no
    // identifying key (including native mouse selection), guard only 80ms:
    // a later independent Enter must never remain latched indefinitely.
    this.endedAt = this.lastCompositionKey && this.lastCompositionKey !== "Enter"
      ? -Infinity : this.now();
  }
  keyup(event: Pick<KeyboardEvent, "key">): void {
    if (event.key === "Enter") { this.enterHeld = false; this.endedAt = -Infinity; }
  }
  reset(): void { this.composing = false; this.enterHeld = false; this.lastCompositionKey = undefined; this.endedAt = -Infinity; }
  keydown(event: EditKey, save: () => void): void {
    if (this.composing || event.isComposing || event.keyCode === 229) {
      // Letter/arrow events are not evidence of how the candidate was committed.
      this.lastCompositionKey = event.key === " " || /^[1-9]$/u.test(event.key) ? event.key : "Enter";
      if (event.key === "Enter") this.enterHeld = true;
      return;
    }
    if (event.key !== "Enter") { this.endedAt = -Infinity; return; }
    if (this.now() - this.endedAt < 80) { this.enterHeld = true; return; }
    if (event.shiftKey) return;
    event.preventDefault();
    if (event.repeat || this.enterHeld) return;
    this.enterHeld = true;
    save();
  }
}
