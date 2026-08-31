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

type NativeInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export type SecureStoreRuntime = {
  loadDeviceIdentity(): Promise<GatewayBrowserDeviceIdentity>;
  createDeviceTokenStore(gatewayUrl: string): GatewayBrowserDeviceTokenStore;
  readConnectionCredential(gatewayUrl: string): Promise<string | null>;
  writeConnectionCredential(gatewayUrl: string, value: string): Promise<void>;
  clearConnectionCredential(gatewayUrl: string): Promise<void>;
};

export function deviceTokenKey(gatewayUrl: string, clientId: string, deviceId: string, role: string): string {
  return `gateway-token:${gatewayUrl}:${clientId}:${deviceId}:${role}`;
}

function connectionCredentialKey(gatewayUrl: string): string {
  return `gateway-connection-credential:${gatewayUrl}`;
}

function tokenCacheKey(params: { clientId: string; deviceId: string; role: string }): string {
  return `${params.clientId}\u0000${params.deviceId}\u0000${params.role}`;
}

function sameTokenRecord(
  current: GatewayBrowserDeviceTokenRecord | null | undefined,
  next: GatewayBrowserDeviceTokenRecord,
): boolean {
  return current?.token === next.token
    && current.scopes.length === next.scopes.length
    && current.scopes.every((scope, index) => scope === next.scopes[index]);
}

export function createSecureStoreRuntime(nativeInvoke: NativeInvoke = invoke as NativeInvoke): SecureStoreRuntime {
  let identityPromise: Promise<GatewayBrowserDeviceIdentity> | undefined;
  const tokenStores = new Map<string, GatewayBrowserDeviceTokenStore>();
  const connectionCredentials = new Map<string, string | null>();
  const connectionCredentialLoads = new Map<string, Promise<string | null>>();

  function loadDeviceIdentity(): Promise<GatewayBrowserDeviceIdentity> {
    if (identityPromise) return identityPromise;
    identityPromise = nativeInvoke("device_identity")
      .then((value) => {
        const identity = value as StoredDeviceIdentity;
        return {
          ...identity,
          sign: async (payload: string) => nativeInvoke("sign_device_payload", { payload }) as Promise<string>,
        };
      })
      .catch((error: unknown) => {
        identityPromise = undefined;
        throw error;
      });
    return identityPromise;
  }

  function createDeviceTokenStore(gatewayUrl: string): GatewayBrowserDeviceTokenStore {
    const existing = tokenStores.get(gatewayUrl);
    if (existing) return existing;
    const records = new Map<string, GatewayBrowserDeviceTokenRecord | null>();
    const pendingLoads = new Map<string, Promise<GatewayBrowserDeviceTokenRecord | null>>();
    const store: GatewayBrowserDeviceTokenStore = {
      async load(params) {
        const cacheKey = tokenCacheKey(params);
        if (records.has(cacheKey)) return records.get(cacheKey) ?? null;
        const pending = pendingLoads.get(cacheKey);
        if (pending) return pending;
        const load = nativeInvoke("secure_get", {
          key: deviceTokenKey(gatewayUrl, params.clientId, params.deviceId, params.role),
        }).then((value) => {
          let record: GatewayBrowserDeviceTokenRecord | null = null;
          if (typeof value === "string" && value) {
            try {
              const parsed = JSON.parse(value) as GatewayBrowserDeviceTokenRecord;
              if (typeof parsed.token === "string" && Array.isArray(parsed.scopes)) record = parsed;
            } catch {
              record = null;
            }
          }
          records.set(cacheKey, record);
          return record;
        }).finally(() => pendingLoads.delete(cacheKey));
        pendingLoads.set(cacheKey, load);
        return load;
      },
      async store(params) {
        const cacheKey = tokenCacheKey(params);
        const next = { token: params.token, scopes: [...params.scopes] };
        if (sameTokenRecord(records.get(cacheKey), next)) return;
        await nativeInvoke("secure_set", {
          key: deviceTokenKey(gatewayUrl, params.clientId, params.deviceId, params.role),
          value: JSON.stringify(next),
        });
        records.set(cacheKey, next);
      },
      async clear(params) {
        const cacheKey = tokenCacheKey(params);
        if (records.get(cacheKey) === null) return;
        await nativeInvoke("secure_delete", {
          key: deviceTokenKey(gatewayUrl, params.clientId, params.deviceId, params.role),
        });
        records.set(cacheKey, null);
      },
    };
    tokenStores.set(gatewayUrl, store);
    return store;
  }

  function readConnectionCredential(gatewayUrl: string): Promise<string | null> {
    if (connectionCredentials.has(gatewayUrl)) {
      return Promise.resolve(connectionCredentials.get(gatewayUrl) ?? null);
    }
    const pending = connectionCredentialLoads.get(gatewayUrl);
    if (pending) return pending;
    const load = nativeInvoke("secure_get", { key: connectionCredentialKey(gatewayUrl) })
      .then((value) => {
        const credential = typeof value === "string" && value ? value : null;
        connectionCredentials.set(gatewayUrl, credential);
        return credential;
      })
      .finally(() => connectionCredentialLoads.delete(gatewayUrl));
    connectionCredentialLoads.set(gatewayUrl, load);
    return load;
  }

  async function writeConnectionCredential(gatewayUrl: string, value: string): Promise<void> {
    await nativeInvoke("secure_set", { key: connectionCredentialKey(gatewayUrl), value });
    connectionCredentials.set(gatewayUrl, value);
  }

  async function clearConnectionCredential(gatewayUrl: string): Promise<void> {
    await nativeInvoke("secure_delete", { key: connectionCredentialKey(gatewayUrl) });
    connectionCredentials.set(gatewayUrl, null);
  }

  return {
    loadDeviceIdentity,
    createDeviceTokenStore,
    readConnectionCredential,
    writeConnectionCredential,
    clearConnectionCredential,
  };
}

export const secureStoreRuntime = createSecureStoreRuntime();
export const loadDeviceIdentity = secureStoreRuntime.loadDeviceIdentity;
export const createDeviceTokenStore = secureStoreRuntime.createDeviceTokenStore;
export const readConnectionCredential = secureStoreRuntime.readConnectionCredential;
export const writeConnectionCredential = secureStoreRuntime.writeConnectionCredential;
export const clearConnectionCredential = secureStoreRuntime.clearConnectionCredential;
