export const PET_SCALES = [33, 50, 75] as const;
export type PetScale = (typeof PET_SCALES)[number];
export type PetOverlay = "none" | "status" | "decision" | "panel";

export type Rectangle = { x: number; y: number; width: number; height: number };
export type PetWindowLayout = {
  width: number;
  height: number;
  pet: Rectangle;
  overlay: Rectangle | null;
  overlayAnchorX: number | null;
};
export type WindowGeometry = Rectangle;
export type PositionedWindowLayout = WindowGeometry & { layout: PetWindowLayout };

const basePet = { width: 612, height: 354 } as const;
const overlayFrame: Record<Exclude<PetOverlay, "none">, {
  width: number;
  height: number;
  top: number;
  bottom: number;
  horizontal: number;
}> = {
  status: { width: 260, height: 56, top: 18, bottom: 46, horizontal: 32 },
  decision: { width: 360, height: 220, top: 20, bottom: 44, horizontal: 32 },
  panel: { width: 360, height: 436, top: 24, bottom: 40, horizontal: 32 },
};

function roundedScaled(value: number, scale: PetScale): number {
  return Math.round(value * scale / 100);
}

export function isPetScale(value: unknown): value is PetScale {
  return typeof value === "number" && (PET_SCALES as readonly number[]).includes(value);
}

export function petViewportForScale(scale: PetScale): { width: number; height: number } {
  return {
    width: roundedScaled(basePet.width, scale),
    height: roundedScaled(basePet.height, scale),
  };
}

export function layoutFor(scale: PetScale, overlay: PetOverlay): PetWindowLayout {
  const petSize = petViewportForScale(scale);
  const frame = overlay === "none" ? null : overlayFrame[overlay];
  const overlayOuterWidth = frame ? frame.width + frame.horizontal * 2 : 0;
  const overlayHeight = frame ? frame.top + frame.height + frame.bottom : 0;
  const width = Math.max(petSize.width, overlayOuterWidth);
  const overlayRect = frame
    ? {
      x: Math.round((width - frame.width) / 2),
      y: frame.top,
      width: frame.width,
      height: frame.height,
    }
    : null;
  return {
    width,
    height: petSize.height + overlayHeight,
    pet: {
      x: Math.round((width - petSize.width) / 2),
      y: overlayHeight,
      ...petSize,
    },
    overlay: overlayRect,
    overlayAnchorX: overlayRect ? overlayRect.width / 2 : null,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function repositionForLayout(
  current: WindowGeometry,
  currentLayout: PetWindowLayout,
  nextLayout: PetWindowLayout,
  scaleFactor: number,
  monitor?: Rectangle,
): PositionedWindowLayout {
  const factor = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  const petLeftX = current.x + currentLayout.pet.x * factor;
  const petCenterX = current.x + (currentLayout.pet.x + currentLayout.pet.width / 2) * factor;
  const petBottomY = current.y + (currentLayout.pet.y + currentLayout.pet.height) * factor;
  const placedLayout: PetWindowLayout = {
    ...nextLayout,
    pet: { ...nextLayout.pet },
    overlay: nextLayout.overlay ? { ...nextLayout.overlay } : null,
  };
  let x = Math.round(petCenterX - (nextLayout.pet.x + nextLayout.pet.width / 2) * factor);
  let y = Math.round(petBottomY - (nextLayout.pet.y + nextLayout.pet.height) * factor);

  if (monitor) {
    if (nextLayout.overlay) {
      const placedOverlay = placedLayout.overlay!;
      const physicalWidth = nextLayout.width * factor;
      x = Math.round(clamp(
        x,
        monitor.x,
        Math.max(monitor.x, monitor.x + monitor.width - physicalWidth),
      ));
      placedLayout.pet.x = Math.round((petLeftX - x) / factor);
      placedLayout.overlayAnchorX = clamp(
        placedLayout.pet.x + placedLayout.pet.width / 2 - placedOverlay.x,
        24,
        placedOverlay.width - 24,
      );
    } else if (!currentLayout.overlay) {
      const petLeftOffset = nextLayout.pet.x * factor;
      const petTopOffset = nextLayout.pet.y * factor;
      const petWidth = nextLayout.pet.width * factor;
      const petHeight = nextLayout.pet.height * factor;
      x = Math.round(clamp(
        x,
        monitor.x - petLeftOffset,
        monitor.x + monitor.width - petLeftOffset - petWidth,
      ));
      y = Math.round(clamp(
        y,
        monitor.y - petTopOffset,
        monitor.y + monitor.height - petTopOffset - petHeight,
      ));
    }
  }

  return {
    x,
    y,
    width: Math.round(nextLayout.width * factor),
    height: Math.round(nextLayout.height * factor),
    layout: placedLayout,
  };
}
