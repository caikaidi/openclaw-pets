import { invoke } from "@tauri-apps/api/core";
import type {
  GatewayBrowserDeviceIdentity,
  GatewayBrowserDeviceTokenRecord,
  GatewayBrowserDeviceTokenStore,
} from "@openclaw/gateway-client/browser";

type StoredDeviceIdentity = {
  deviceId: string;
  publicKey: string;
};

export function deviceTokenKey(gatewayUrl: string, clientId: string, deviceId: string, role: string): string {
  return `gateway-token:${gatewayUrl}:${clientId}:${deviceId}:${role}`;
}

function connectionCredentialKey(gatewayUrl: string): string {
  return `gateway-connection-credential:${gatewayUrl}`;
}

export async function loadDeviceIdentity(): Promise<GatewayBrowserDeviceIdentity> {
  const identity = await invoke<StoredDeviceIdentity>("device_identity");
  return {
    ...identity,
    sign: (payload) => invoke<string>("sign_device_payload", { payload }),
  };
}

export function createDeviceTokenStore(gatewayUrl: string): GatewayBrowserDeviceTokenStore {
  return {
    async load(params) {
      const value = await invoke<string | null>("secure_get", {
        key: deviceTokenKey(gatewayUrl, params.clientId, params.deviceId, params.role),
      });
      if (!value) return null;
      try {
        const parsed = JSON.parse(value) as GatewayBrowserDeviceTokenRecord;
        return typeof parsed.token === "string" && Array.isArray(parsed.scopes) ? parsed : null;
      } catch {
        return null;
      }
    },
    async store(params) {
      await invoke("secure_set", {
        key: deviceTokenKey(gatewayUrl, params.clientId, params.deviceId, params.role),
        value: JSON.stringify({ token: params.token, scopes: params.scopes }),
      });
    },
    async clear(params) {
      await invoke("secure_delete", {
        key: deviceTokenKey(gatewayUrl, params.clientId, params.deviceId, params.role),
      });
    },
  };
}

export function readConnectionCredential(gatewayUrl: string): Promise<string | null> {
  return invoke<string | null>("secure_get", { key: connectionCredentialKey(gatewayUrl) });
}

export function writeConnectionCredential(gatewayUrl: string, value: string): Promise<void> {
  return invoke<void>("secure_set", { key: connectionCredentialKey(gatewayUrl), value });
}

export function clearConnectionCredential(gatewayUrl: string): Promise<void> {
  return invoke<void>("secure_delete", { key: connectionCredentialKey(gatewayUrl) });
}
