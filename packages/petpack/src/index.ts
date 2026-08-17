import {
  PET_SEMANTIC_STATES,
  type PetSemanticState,
} from "@openclaw-pets/protocol";

export type PetAsset = {
  path: string;
  mimeType: "image/png" | "image/webp";
  sha256: string;
  width: number;
  height: number;
  frameWidth: number;
  frameHeight: number;
};

export type PetAnimation = {
  asset: string;
  frames: number[];
  fps: number;
  loop: boolean;
  visibleBottom?: number;
};

export type PetPackManifest = {
  formatVersion: 1;
  id: string;
  version: string;
  name: string;
  license: string;
  engine: { min: string };
  assets: Record<string, PetAsset>;
  states: Partial<Record<PetSemanticState, PetAnimation>> & { idle: PetAnimation };
};

export type PetPackValidationResult =
  | { ok: true; value: PetPackManifest }
  | { ok: false; errors: string[] };

const rootKeys = new Set([
  "formatVersion",
  "id",
  "version",
  "name",
  "license",
  "engine",
  "assets",
  "states",
]);
const assetKeys = new Set(["path", "mimeType", "sha256", "width", "height", "frameWidth", "frameHeight"]);
const animationKeys = new Set(["asset", "frames", "fps", "loop", "visibleBottom"]);
const safeAssetPath = /^assets\/[A-Za-z0-9][A-Za-z0-9._/-]*\.(?:png|webp)$/u;
const packageId = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/u;
const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const sha256 = /^[0-9a-f]{64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: Set<string>): boolean {
  return Object.keys(value).every((key) => keys.has(key));
}

function isPositiveInteger(value: unknown, max: number): value is number {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= max;
}

function validateAsset(name: string, value: unknown, errors: string[]): value is PetAsset {
  if (!isRecord(value) || !hasOnlyKeys(value, assetKeys)) {
    errors.push(`asset ${name} contains unknown or invalid fields`);
    return false;
  }
  const path = value.path;
  if (typeof path !== "string"
    || !safeAssetPath.test(path)
    || path.includes("..")
    || path.includes(":")
    || path.includes("//")) {
    errors.push(`asset ${name} has an unsafe path`);
  }
  if (value.mimeType !== "image/png" && value.mimeType !== "image/webp") {
    errors.push(`asset ${name} must be PNG or WebP`);
  }
  if (typeof value.sha256 !== "string" || !sha256.test(value.sha256)) {
    errors.push(`asset ${name} must declare a lowercase SHA-256`);
  }
  if (!isPositiveInteger(value.width, 8_192) || !isPositiveInteger(value.height, 8_192)) {
    errors.push(`asset ${name} dimensions must be between 1 and 8192`);
  }
  if (!isPositiveInteger(value.frameWidth, 8_192) || !isPositiveInteger(value.frameHeight, 8_192)) {
    errors.push(`asset ${name} frame dimensions must be between 1 and 8192`);
  } else if (typeof value.width === "number"
    && typeof value.height === "number"
    && (value.width % value.frameWidth !== 0 || value.height % value.frameHeight !== 0)) {
    errors.push(`asset ${name} dimensions must be divisible by its frame dimensions`);
  }
  return errors.length === 0;
}

function validateAnimation(
  state: string,
  value: unknown,
  assets: Record<string, PetAsset>,
  errors: string[],
): value is PetAnimation {
  const initialErrorCount = errors.length;
  if (!isRecord(value) || !hasOnlyKeys(value, animationKeys)) {
    errors.push(`state ${state} contains unknown or invalid fields`);
    return false;
  }
  if (typeof value.asset !== "string" || !(value.asset in assets)) {
    errors.push(`state ${state} references an unknown asset`);
  }
  const asset = typeof value.asset === "string" ? assets[value.asset] : undefined;
  const frameCapacity = asset
    ? (asset.width / asset.frameWidth) * (asset.height / asset.frameHeight)
    : 0;
  if (!Array.isArray(value.frames)
    || value.frames.length === 0
    || value.frames.length > 512
    || value.frames.some((frame) => !Number.isInteger(frame) || frame < 0 || frame >= frameCapacity)) {
    errors.push(`state ${state} has invalid frames`);
  }
  if (typeof value.fps !== "number" || !Number.isFinite(value.fps) || value.fps < 1 || value.fps > 60) {
    errors.push(`state ${state} fps must be between 1 and 60`);
  }
  if (typeof value.loop !== "boolean") errors.push(`state ${state} loop must be boolean`);
  if (value.visibleBottom !== undefined
    && (!asset
      || !Number.isInteger(value.visibleBottom)
      || Number(value.visibleBottom) < 1
      || Number(value.visibleBottom) > asset.frameHeight)) {
    errors.push(`state ${state} visibleBottom must fit inside its frame`);
  }
  return errors.length === initialErrorCount;
}

export function validatePetPackManifest(value: unknown): PetPackValidationResult {
  const errors: string[] = [];
  if (!isRecord(value) || !hasOnlyKeys(value, rootKeys)) {
    return { ok: false, errors: ["manifest contains unknown or invalid fields"] };
  }
  if (value.formatVersion !== 1) errors.push("formatVersion must be 1");
  if (typeof value.id !== "string" || !packageId.test(value.id) || value.id.length > 128) {
    errors.push("id must be a lowercase reverse-domain identifier");
  }
  if (typeof value.version !== "string" || !semver.test(value.version)) errors.push("version must be semver");
  if (typeof value.name !== "string" || value.name.trim().length === 0 || value.name.length > 128) {
    errors.push("name must be between 1 and 128 characters");
  }
  if (typeof value.license !== "string" || value.license.trim().length === 0 || value.license.length > 128) {
    errors.push("license is required");
  }
  if (!isRecord(value.engine)
    || !hasOnlyKeys(value.engine, new Set(["min"]))
    || typeof value.engine.min !== "string"
    || !semver.test(value.engine.min)) {
    errors.push("engine.min must be semver");
  }

  const assets: Record<string, PetAsset> = {};
  if (!isRecord(value.assets) || Object.keys(value.assets).length === 0 || Object.keys(value.assets).length > 32) {
    errors.push("assets must contain between 1 and 32 entries");
  } else {
    for (const [name, asset] of Object.entries(value.assets)) {
      const assetErrors: string[] = [];
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(name)) assetErrors.push(`asset ${name} has an invalid id`);
      if (validateAsset(name, asset, assetErrors)) assets[name] = asset;
      errors.push(...assetErrors);
    }
  }

  const states: Partial<Record<PetSemanticState, PetAnimation>> = {};
  if (!isRecord(value.states) || Object.keys(value.states).length === 0) {
    errors.push("states must not be empty");
  } else {
    for (const [state, animation] of Object.entries(value.states)) {
      if (!(PET_SEMANTIC_STATES as readonly string[]).includes(state)) {
        errors.push(`unknown semantic state ${state}`);
        continue;
      }
      if (validateAnimation(state, animation, assets, errors)) {
        states[state as PetSemanticState] = animation;
      }
    }
  }
  if (!states.idle) errors.push("states.idle is required as the fallback animation");

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: value as PetPackManifest };
}

export function resolvePetAnimation(manifest: PetPackManifest, state: PetSemanticState): PetAnimation {
  return manifest.states[state] ?? manifest.states.idle;
}
