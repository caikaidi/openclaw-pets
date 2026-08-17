import { describe, expect, it } from "vitest";
import { validateLoadedPetPack } from "../src/runtime/pet-pack-loader.js";

describe("active Pet Pack loader", () => {
  it("accepts only assets whose bytes match the validated manifest", async () => {
    const manifest = {
      formatVersion: 1,
      id: "org.example.one-frame",
      version: "1.0.0",
      name: "One Frame",
      license: "CC0-1.0",
      engine: { min: "0.1.0" },
      assets: {
        main: {
          path: "assets/pet.png",
          mimeType: "image/png",
          sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
          width: 1,
          height: 1,
          frameWidth: 1,
          frameHeight: 1,
        },
      },
      states: { idle: { asset: "main", frames: [0], fps: 1, loop: true } },
    };
    const payload = {
      manifest: JSON.stringify(manifest),
      assets: [{ path: "assets/pet.png", mimeType: "image/png", base64: "aGVsbG8=" }],
    };

    await expect(validateLoadedPetPack(payload)).resolves.toMatchObject({
      manifest: { id: "org.example.one-frame" },
      assetUrls: { "assets/pet.png": "data:image/png;base64,aGVsbG8=" },
    });

    payload.assets[0]!.base64 = "dGFtcGVyZWQ=";
    await expect(validateLoadedPetPack(payload)).rejects.toThrow("SHA-256");
  });
});
