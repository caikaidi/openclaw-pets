import { describe, expect, it, vi } from "vitest";
import type { RawPetPackPayload } from "../src/runtime/pet-pack-loader.js";
import { PetPackManager, type PetPackManagerBridge, type PetPackSummary } from "../src/runtime/pet-pack-manager.js";

const manifest = {
  formatVersion: 1,
  id: "local.petdex.sample",
  version: "1.0.0",
  name: "Sample Pet",
  license: "NOASSERTION",
  engine: { min: "0.4.0" },
  assets: {
    main: {
      path: "assets/spritesheet.png",
      mimeType: "image/png",
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      width: 1,
      height: 1,
      frameWidth: 1,
      frameHeight: 1,
    },
  },
  states: { idle: { asset: "main", frames: [0], fps: 8, loop: true } },
};

const payload: RawPetPackPayload = {
  manifest: JSON.stringify(manifest),
  assets: [{ path: "assets/spritesheet.png", mimeType: "image/png", base64: "" }],
};

function harness() {
  const summary: PetPackSummary = {
    key: "local-petdex-sample-123456789abc",
    id: "local.petdex.sample",
    name: "Sample Pet",
    license: "NOASSERTION",
    source: "petdex",
    active: false,
  };
  const invoke = vi.fn(async (command: string) => {
    if (command === "import_pet_pack") return summary;
    if (command === "read_pet_pack") return payload;
    if (command === "activate_pet_pack") return undefined;
    if (command === "list_pet_packs") return [summary];
    throw new Error(`unexpected command ${command}`);
  });
  const bridge: PetPackManagerBridge = {
    invoke: invoke as PetPackManagerBridge["invoke"],
    chooseZip: async () => "/tmp/sample.zip",
    chooseDirectory: async () => null,
    openPetdex: async () => undefined,
  };
  return { manager: new PetPackManager(bridge), invoke };
}

describe("PetPackManager", () => {
  it("imports and previews a downloaded pack without activating it", async () => {
    const { manager, invoke } = harness();
    const imported = await manager.import("zip");

    expect(imported?.summary.active).toBe(false);
    expect(imported?.preview.manifest.name).toBe("Sample Pet");
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "import_pet_pack",
      "read_pet_pack",
    ]);
  });

  it("validates the preview before activating a selected pack", async () => {
    const { manager, invoke } = harness();
    await manager.activate("local-petdex-sample-123456789abc");

    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "read_pet_pack",
      "activate_pet_pack",
    ]);
  });

  it("removes a rejected import without changing the active pack", async () => {
    const { manager, invoke } = harness();
    invoke.mockImplementation(async (command: string) => {
      if (command === "import_pet_pack") return {
        key: "invalid-pack",
        id: "local.petdex.invalid",
        name: "Invalid",
        license: "NOASSERTION",
        source: "petdex",
        active: false,
      };
      if (command === "read_pet_pack") throw new Error("invalid manifest");
      if (command === "remove_pet_pack") return true;
      throw new Error(`unexpected command ${command}`);
    });

    await expect(manager.import("zip")).rejects.toThrow("invalid manifest");
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "import_pet_pack",
      "read_pet_pack",
      "remove_pet_pack",
    ]);
    expect(invoke.mock.calls.map(([command]) => command)).not.toContain("activate_pet_pack");
  });
});
