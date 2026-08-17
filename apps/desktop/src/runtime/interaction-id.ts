import { loadDeviceIdentity } from "./secure-store.js";

type DeviceIdentity = { deviceId: string };

export function deviceInteractionId(deviceId: string, interactionId: string): string {
  const device = deviceId.trim().toLowerCase();
  const interaction = interactionId.trim().toLowerCase();
  if (!/^[a-f0-9]{32,64}$/u.test(device) || !/^[a-f0-9-]{16,64}$/u.test(interaction)) {
    throw new Error("Device interaction identity is invalid");
  }
  const value = `${device}.${interaction}`;
  if (value.length > 128) throw new Error("Device interaction identity is too long");
  return value;
}

export async function createDeviceInteractionId(
  loadIdentity: () => Promise<DeviceIdentity> = loadDeviceIdentity,
  createId: () => string = () => crypto.randomUUID(),
): Promise<string> {
  const identity = await loadIdentity();
  return deviceInteractionId(identity.deviceId, createId());
}
