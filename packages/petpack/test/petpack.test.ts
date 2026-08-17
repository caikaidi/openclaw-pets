import { describe, expect, it } from "vitest";
import { resolvePetAnimation, validatePetPackManifest } from "../src/index.js";

const validManifest = {
  formatVersion: 1,
  id: "org.example.fox",
  version: "1.2.0",
  name: "Example Fox",
  license: "CC-BY-4.0",
  engine: { min: "0.1.0" },
  assets: {
    main: {
      path: "assets/spritesheet.webp",
      mimeType: "image/webp",
      sha256: "a".repeat(64),
      width: 1536,
      height: 1872,
      frameWidth: 256,
      frameHeight: 208,
    },
  },
  states: {
    idle: { asset: "main", frames: [0, 1, 2, 3], fps: 8, loop: true },
    thinking: { asset: "main", frames: [8, 9, 10, 11], fps: 12, loop: true },
  },
};

describe("Pet Pack", () => {
  it("accepts an inert raster-only manifest", () => {
    expect(validatePetPackManifest(validManifest)).toEqual({ ok: true, value: validManifest });
  });

  it("accepts an optional per-animation visible bottom", () => {
    const manifest = {
      ...structuredClone(validManifest),
      states: {
        ...structuredClone(validManifest.states),
        idle: {
          ...structuredClone(validManifest.states.idle),
          visibleBottom: 175,
        },
      },
    };

    expect(validatePetPackManifest(manifest)).toEqual({ ok: true, value: manifest });
  });

  it("rejects a visible bottom outside the referenced frame", () => {
    const manifest = {
      ...structuredClone(validManifest),
      states: {
        ...structuredClone(validManifest.states),
        idle: {
          ...structuredClone(validManifest.states.idle),
          visibleBottom: 209,
        },
      },
    };

    expect(validatePetPackManifest(manifest).ok).toBe(false);
  });

  it.each([
    "../outside.webp",
    "/tmp/pet.webp",
    "https://example.com/pet.webp",
    "assets/behavior.js",
    "assets/vector.svg",
  ])("rejects unsafe asset path %s", (path) => {
    const manifest = structuredClone(validManifest);
    manifest.assets.main.path = path;

    const result = validatePetPackManifest(manifest);

    expect(result.ok).toBe(false);
  });

  it("falls back to idle when a pack omits an optional semantic state", () => {
    const result = validatePetPackManifest(validManifest);
    if (!result.ok) throw new Error(result.errors.join(", "));

    expect(resolvePetAnimation(result.value, "needs_input")).toEqual(result.value.states.idle);
    expect(resolvePetAnimation(result.value, "thinking")).toEqual(result.value.states.thinking);
  });

  it("rejects unknown executable-shaped manifest fields", () => {
    const result = validatePetPackManifest({ ...validManifest, script: "assets/setup.js" });
    expect(result.ok).toBe(false);
  });

  it("rejects sprite geometry that cannot address every declared frame", () => {
    const manifest = structuredClone(validManifest);
    manifest.assets.main.frameWidth = 1_000;
    expect(validatePetPackManifest(manifest).ok).toBe(false);

    const outOfRange = structuredClone(validManifest);
    outOfRange.states.idle.frames = [54];
    expect(validatePetPackManifest(outOfRange).ok).toBe(false);
  });
});
