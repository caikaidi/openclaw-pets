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
      const next = repositionForLayout(
        { x: position.x, y: position.y, width: size.width, height: size.height },
        this.layout,
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
      await commitWindowTransition(appWindow, next, factor, commitLayout);
      this.layout = next.layout;
      return this.layout;
    });
    return this.operation;
  }

  startDragging(): Promise<void> {
    return isTauri() ? getCurrentWindow().startDragging() : Promise.resolve();
  }
}
