import { PETS_PROTOCOL_VERSION, type AsrCapability } from "@openclaw-pets/protocol";

export function isCompatibleCapabilities(value: { protocolVersion?: unknown }): boolean {
  return value.protocolVersion === PETS_PROTOCOL_VERSION;
}

export function asrCapabilityLabel(capability: AsrCapability): string {
  if (!capability.available || capability.health === "unconfigured") return "未配置";
  const primary = capability.primary ?? "ASR Provider";
  if (capability.health === "degraded" && capability.fallback) {
    return `${primary} → ${capability.fallback}（已切换备用）`;
  }
  if (capability.health === "healthy") return `${primary}（正常）`;
  if (capability.health === "unavailable") return `${primary}（不可用）`;
  return `${primary}（已配置）`;
}
