import { describe, expect, it } from "vitest";
import { isOpaqueSpritePoint } from "../src/runtime/sprite-hit-test.js";

const asset = {
  path: "assets/sprites.png",
  mimeType: "image/png" as const,
  sha256: "a".repeat(64),
  width: 4,
  height: 2,
  frameWidth: 2,
  frameHeight: 2,
};
const data = new Uint8ClampedArray(4 * 2 * 4);
data[(0 * 4 + 2) * 4 + 3] = 255;

describe("sprite alpha hit testing", () => {
  it("accepts only opaque pixels in the active animation frame", () => {
    const bitmap = { width: 4, height: 2, data };
    const bounds = { left: 100, top: 50, width: 20, height: 20 };

    expect(isOpaqueSpritePoint(bitmap, asset, 1, bounds, 101, 51)).toBe(true);
    expect(isOpaqueSpritePoint(bitmap, asset, 1, bounds, 119, 69)).toBe(false);
    expect(isOpaqueSpritePoint(bitmap, asset, 0, bounds, 101, 51)).toBe(false);
    expect(isOpaqueSpritePoint(bitmap, asset, 1, bounds, 99, 51)).toBe(false);
  });
});
