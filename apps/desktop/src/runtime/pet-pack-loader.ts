import { invoke } from "@tauri-apps/api/core";
import { validatePetPackManifest, type PetPackManifest } from "@openclaw-pets/petpack";

export type RawPetPackPayload = {
  manifest: string;
  assets: Array<{ path: string; mimeType: string; base64: string }>;
};

export type LoadedPetPack = {
  manifest: PetPackManifest;
  assetUrls: Record<string, string>;
};

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function validateLoadedPetPack(payload: RawPetPackPayload): Promise<LoadedPetPack> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.manifest);
  } catch {
    throw new Error("Pet Pack manifest is not valid JSON");
  }
  const validated = validatePetPackManifest(parsed);
  if (!validated.ok) throw new Error(`Pet Pack manifest is invalid: ${validated.errors.join("; ")}`);

  const files = new Map(payload.assets.map((asset) => [asset.path, asset]));
  const assetUrls: Record<string, string> = {};
  for (const asset of Object.values(validated.value.assets)) {
    const file = files.get(asset.path);
    if (!file || file.mimeType !== asset.mimeType) throw new Error(`Pet Pack asset ${asset.path} is missing or has the wrong type`);
    const bytes = decodeBase64(file.base64);
    if (await sha256Hex(bytes) !== asset.sha256) throw new Error(`Pet Pack asset ${asset.path} failed SHA-256 verification`);
    assetUrls[asset.path] = `data:${asset.mimeType};base64,${file.base64}`;
  }
  return { manifest: validated.value, assetUrls };
}

export async function loadActivePetPack(): Promise<LoadedPetPack | null> {
  if (!("__TAURI_INTERNALS__" in window)) return null;
  const payload = await invoke<RawPetPackPayload | null>("read_active_pet_pack");
  return payload ? validateLoadedPetPack(payload) : null;
}
