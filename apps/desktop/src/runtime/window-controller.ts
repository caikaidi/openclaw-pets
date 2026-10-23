import {
  LogicalPosition,
  LogicalSize,
  currentMonitor,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import {
  layoutFor,
  repositionForLayout,
  type PositionedWindowLayout,
  type PetOverlay,
  type PetScale,
  type PetWindowLayout,
} from "./window-layout.js";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

type WindowTransitionPort = {
  hide(): Promise<void>;
  setSize(size: LogicalSize): Promise<void>;
  setPosition(position: LogicalPosition): Promise<void>;
  show(): Promise<void>;
};

export async function commitWindowTransition(
  appWindow: WindowTransitionPort,
  next: PositionedWindowLayout,
  scaleFactor: number,
  commitLayout: (layout: PetWindowLayout) => void | Promise<void>,
): Promise<void> {
  await appWindow.hide();
  try {
    await appWindow.setSize(new LogicalSize(next.layout.width, next.layout.height));
    await appWindow.setPosition(new LogicalPosition(next.x / scaleFactor, next.y / scaleFactor));
    await commitLayout(next.layout);
  } finally {
    await appWindow.show();
  }
}

export class PetWindowController {
  private layout: PetWindowLayout;
  private operation: Promise<PetWindowLayout>;
  private nativeLayoutInitialized = false;
  transitioning = false;
  private focusListeners = new Set<(focused: boolean) => void>();

  isFocused(): Promise<boolean> {
    return isTauri() ? getCurrentWindow().isFocused() : Promise.resolve(typeof document !== "undefined" && document.hasFocus());
  }

  async onFocusChanged(listener: (focused: boolean) => void): Promise<() => void> {
    this.focusListeners.add(listener);
    try {
      const stop = isTauri()
        ? await getCurrentWindow().onFocusChanged(({ payload }) => { if (!this.transitioning) listener(payload); })
        : () => undefined;
      return () => { this.focusListeners.delete(listener); stop(); };
    } catch (cause) { this.focusListeners.delete(listener); throw cause; }
  }

  onCloseRequested(shouldKeepOpen: () => boolean): Promise<() => void> {
    return isTauri()
      ? getCurrentWindow().onCloseRequested((event) => { if (shouldKeepOpen()) event.preventDefault(); })
      : Promise.resolve(() => undefined);
  }

  constructor(scale: PetScale, overlay: PetOverlay) {
    this.layout = layoutFor(scale, overlay);
    this.operation = Promise.resolve(this.layout);
  }

  apply(
    scale: PetScale,
    overlay: PetOverlay,
    commitLayout: (layout: PetWindowLayout) => void | Promise<void> = () => undefined,
  ): Promise<PetWindowLayout> {
    const nextLayout = layoutFor(scale, overlay);
    if (!isTauri()) {
      this.layout = nextLayout;
      return Promise.resolve(commitLayout(this.layout)).then(() => this.layout);
    }
    this.operation = this.operation.then(async () => {
      const appWindow = getCurrentWindow();
      const [position, size, factor, monitor] = await Promise.all([
        appWindow.outerPosition(),
        appWindow.outerSize(),
        appWindow.scaleFactor(),
        currentMonitor(),
      ]);
      // A frontend reload retains the native bounds, not the launch layout.
      // The pet sits at the window bottom in every layout; recover that anchor
      // before the first transition instead of adding the launch status headroom.
      const currentLayout = this.nativeLayoutInitialized ? this.layout : {
        ...this.layout,
        pet: { ...this.layout.pet, y: size.height / factor - this.layout.pet.height },
      };
      const next = repositionForLayout(
        { x: position.x, y: position.y, width: size.width, height: size.height },
        currentLayout,
        nextLayout,
        factor,
        monitor
          ? {
            x: monitor.position.x,
            y: monitor.position.y,
            width: monitor.size.width,
            height: monitor.size.height,
          }
          : undefined,
      );
      this.transitioning = true;
      try {
        await commitWindowTransition(appWindow, next, factor, commitLayout);
      } finally {
        this.transitioning = false;
        // hide/show may swallow the final native focus event; reconcile actual focus.
        try {
          const focused = await this.isFocused();
          this.focusListeners.forEach((listener) => listener(focused));
        } catch { /* DOM focus remains available if the native query fails. */ }
      }
      this.layout = next.layout;
      this.nativeLayoutInitialized = true;
      return this.layout;
    });
    return this.operation;
  }

  startDragging(): Promise<void> {
    return isTauri() ? getCurrentWindow().startDragging() : Promise.resolve();
  }
}
