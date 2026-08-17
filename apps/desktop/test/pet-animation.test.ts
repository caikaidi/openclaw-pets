import { describe, expect, it } from "vitest";
import { animationFrame, spriteStyle } from "../src/runtime/pet-animation.js";

const asset = {
  path: "assets/pet.webp",
  mimeType: "image/webp" as const,
  sha256: "a".repeat(64),
  width: 768,
  height: 416,
  frameWidth: 256,
  frameHeight: 208,
};

describe("Pet Pack animation", () => {
  it("advances looping and one-shot frame sequences deterministically", () => {
    expect(animationFrame({ asset: "main", frames: [2, 4, 5], fps: 10, loop: true }, 310)).toBe(2);
    expect(animationFrame({ asset: "main", frames: [2, 4, 5], fps: 10, loop: false }, 900)).toBe(5);
  });

  it("maps a frame to its sprite-sheet cell", () => {
    expect(spriteStyle(asset, "data:image/webp;base64,abc", 4)).toMatchObject({
      backgroundImage: "url(\"data:image/webp;base64,abc\")",
      backgroundSize: "300% 200%",
      backgroundPosition: "50% 100%",
      aspectRatio: "256 / 208",
    });
  });

  it("aligns the visible sprite bottom with the pet viewport", () => {
    expect(spriteStyle(asset, "data:image/webp;base64,abc", 0, 175)).toMatchObject({
      transform: "translate(-50%, 15.865384615384615%)",
    });
  });
});
