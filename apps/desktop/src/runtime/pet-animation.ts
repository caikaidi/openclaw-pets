import type { PetAnimation, PetAsset } from "@openclaw-pets/petpack";

export type SpriteStyle = {
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
  aspectRatio: string;
  transform: string;
};

export function animationFrame(animation: PetAnimation, elapsedMs: number): number {
  const step = Math.max(0, Math.floor(elapsedMs * animation.fps / 1_000));
  const index = animation.loop
    ? step % animation.frames.length
    : Math.min(step, animation.frames.length - 1);
  return animation.frames[index] ?? animation.frames[0] ?? 0;
}

export function spriteStyle(
  asset: PetAsset,
  assetUrl: string,
  frame: number,
  visibleBottom?: number,
): SpriteStyle {
  const columns = asset.width / asset.frameWidth;
  const rows = asset.height / asset.frameHeight;
  const column = frame % columns;
  const row = Math.floor(frame / columns);
  const position = (cell: number, count: number): string => count <= 1
    ? "0%"
    : `${cell / (count - 1) * 100}%`;
  return {
    backgroundImage: `url("${assetUrl.replaceAll('"', "%22")}")`,
    backgroundSize: `${columns * 100}% ${rows * 100}%`,
    backgroundPosition: `${position(column, columns)} ${position(row, rows)}`,
    aspectRatio: `${asset.frameWidth} / ${asset.frameHeight}`,
    transform: `translate(-50%, ${visibleBottom
      ? (asset.frameHeight - visibleBottom) / asset.frameHeight * 100
      : 0}%)`,
  };
}
