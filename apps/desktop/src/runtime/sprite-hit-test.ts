import type { PetAsset } from "@openclaw-pets/petpack";

export type AlphaBitmap = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export type ClientRectangle = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function isOpaqueSpritePoint(
  bitmap: AlphaBitmap | undefined,
  asset: PetAsset,
  frame: number,
  bounds: ClientRectangle,
  clientX: number,
  clientY: number,
): boolean {
  if (!bitmap || bitmap.width !== asset.width || bitmap.height !== asset.height
    || bounds.width <= 0 || bounds.height <= 0) return false;
  const localX = (clientX - bounds.left) / bounds.width;
  const localY = (clientY - bounds.top) / bounds.height;
  if (localX < 0 || localX >= 1 || localY < 0 || localY >= 1) return false;
  const columns = asset.width / asset.frameWidth;
  const rows = asset.height / asset.frameHeight;
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || frame < 0 || frame >= columns * rows) {
    return false;
  }
  const frameX = frame % columns;
  const frameY = Math.floor(frame / columns);
  const pixelX = frameX * asset.frameWidth + Math.floor(localX * asset.frameWidth);
  const pixelY = frameY * asset.frameHeight + Math.floor(localY * asset.frameHeight);
  const alphaIndex = (pixelY * bitmap.width + pixelX) * 4 + 3;
  return (bitmap.data[alphaIndex] ?? 0) >= 12;
}
