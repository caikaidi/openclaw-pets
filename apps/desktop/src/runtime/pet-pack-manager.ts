import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  validateLoadedPetPack,
  type LoadedPetPack,
  type RawPetPackPayload,
} from "./pet-pack-loader.js";

export type PetPackSummary = {
  key: string;
  id: string;
  name: string;
  license: string;
  active: boolean;
  source: "petdex" | "openclaw" | string;
};

export type ImportedPetPack = {
  summary: PetPackSummary;
  preview: LoadedPetPack;
};

export type PetPackManagerBridge = {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  chooseZip(): Promise<string | null>;
  chooseDirectory(): Promise<string | null>;
  openPetdex(): Promise<void>;
};

const defaultBridge: PetPackManagerBridge = {
  invoke,
  chooseZip: async () => await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Pet Pack ZIP", extensions: ["zip"] }],
  }),
  chooseDirectory: async () => await open({ multiple: false, directory: true }),
  openPetdex: async () => await openUrl("https://codex-pets.net/"),
};

export class PetPackManager {
  constructor(private readonly bridge: PetPackManagerBridge = defaultBridge) {}

  async list(): Promise<PetPackSummary[]> {
    return await this.bridge.invoke<PetPackSummary[]>("list_pet_packs");
  }

  async openPetdex(): Promise<void> {
    await this.bridge.openPetdex();
  }

  async import(kind: "zip" | "directory"): Promise<ImportedPetPack | undefined> {
    const sourcePath = kind === "zip"
      ? await this.bridge.chooseZip()
      : await this.bridge.chooseDirectory();
    if (!sourcePath) return undefined;
    const summary = await this.bridge.invoke<PetPackSummary>("import_pet_pack", { sourcePath });
    try {
      const payload = await this.bridge.invoke<RawPetPackPayload>("read_pet_pack", { key: summary.key });
      return { summary, preview: await validateLoadedPetPack(payload) };
    } catch (cause) {
      await this.bridge.invoke<boolean>("remove_pet_pack", { key: summary.key }).catch(() => false);
      throw cause;
    }
  }

  async preview(key: string): Promise<LoadedPetPack> {
    const payload = await this.bridge.invoke<RawPetPackPayload>("read_pet_pack", { key });
    return await validateLoadedPetPack(payload);
  }

  async activate(key: string): Promise<LoadedPetPack> {
    const preview = await this.preview(key);
    await this.bridge.invoke<void>("activate_pet_pack", { key });
    return preview;
  }

  async remove(key: string): Promise<boolean> {
    return await this.bridge.invoke<boolean>("remove_pet_pack", { key });
  }
}
