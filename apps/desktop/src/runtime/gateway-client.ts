import {
  GatewayBrowserDeviceAuthLifecycle,
  GatewayProtocolClient,
  GatewayProtocolRequestError,
  type GatewayProtocolRequestOptions,
  shouldPauseGatewayReconnect,
  type EventFrame,
  type GatewayBrowserDeviceAuthPlan,
  type GatewayProtocolSocket,
  type GatewayProtocolSocketHandlers,
  type HelloOk,
} from "@openclaw/gateway-client/browser";
import {
  GATEWAY_CLIENT_IDS,
  GATEWAY_CLIENT_MODES,
  type GatewayClientInfo,
} from "@openclaw/gateway-protocol/client-info";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";
import {
  clearConnectionCredential,
  createDeviceTokenStore,
  loadDeviceIdentity,
  readConnectionCredential,
} from "./secure-store.js";

export type GatewayConnectionState = "disconnected" | "connecting" | "connected" | "pairing" | "error";

export type PetsGatewayClientOptions = {
  url: string;
  appVersion: string;
  onStateChange?: (state: GatewayConnectionState, detail?: string) => void;
  onEvent?: (event: EventFrame) => void;
  onHello?: (hello: HelloOk) => void;
};

type PetsGatewayAuthPlan = GatewayBrowserDeviceAuthPlan & {
  usedConnectionCredential: boolean;
};

export const gatewayRequestedScopes = ["operator.read", "operator.write"] as const;

export function validateGatewayWebSocketUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("Gateway address must be a valid WebSocket URL");
  }
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new Error("Gateway address must use a WebSocket URL");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Gateway URL credentials are not allowed; use the secure credential field");
  }
  if (parsed.hash) throw new Error("Gateway WebSocket URL may not contain a fragment");
  const loopback = parsed.hostname === "localhost"
    || parsed.hostname === "127.0.0.1"
    || parsed.hostname === "[::1]";
  if (parsed.protocol === "ws:" && !loopback) {
    throw new Error("Remote Gateway connections must use wss://");
  }
  return parsed.toString();
}

export function gatewayClientInfo(appVersion: string, platform: string): GatewayClientInfo {
  return {
    id: GATEWAY_CLIENT_IDS.GATEWAY_CLIENT,
    displayName: "OpenClaw Pets",
    version: appVersion,
    platform,
    deviceFamily: "desktop",
    mode: GATEWAY_CLIENT_MODES.UI,
  };
}

export function gatewayConnectionCredential(token: string | undefined): { token?: string } {
  return token ? { token } : {};
}

function createBrowserSocket(url: string, handlers: GatewayProtocolSocketHandlers): GatewayProtocolSocket {
  const socket = new WebSocket(url);
  socket.addEventListener("open", () => handlers.open());
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") handlers.message(event.data);
  });
  socket.addEventListener("close", (event) => handlers.close(event.code, event.reason));
  socket.addEventListener("error", () => handlers.error(new Error("Gateway WebSocket failed")));
  return {
    isOpen: () => socket.readyState === WebSocket.OPEN,
    send: (data) => socket.send(data),
    close: (code, reason) => socket.close(code, reason),
  };
}

function connectionDetail(error: unknown): string {
  if (!(error instanceof Error)) return "Gateway connection failed";
  return error.message.slice(0, 240);
}

export class PetsGatewayClient {
  private readonly auth: GatewayBrowserDeviceAuthLifecycle;
  private readonly client: GatewayProtocolClient<PetsGatewayAuthPlan>;
  private state: GatewayConnectionState = "disconnected";

  constructor(private readonly options: PetsGatewayClientOptions) {
    const clientInfo = gatewayClientInfo(options.appVersion, navigator.platform || "macos");
    this.auth = new GatewayBrowserDeviceAuthLifecycle({
      loadIdentity: async () => loadDeviceIdentity(),
      tokenStore: createDeviceTokenStore(options.url),
    });
    this.client = new GatewayProtocolClient<PetsGatewayAuthPlan>({
      createSocket: (handlers) => createBrowserSocket(options.url, handlers),
      createRequestId: () => crypto.randomUUID(),
      buildConnectPlan: async ({ nonce, challengeTs }) => {
        const connectionToken = (await readConnectionCredential(options.url)) ?? undefined;
        const plan = await this.auth.buildPlan({
          client: clientInfo,
          role: "operator",
          defaultScopes: gatewayRequestedScopes,
          ...gatewayConnectionCredential(connectionToken),
          nonce,
          ...(challengeTs === undefined ? {} : { challengeTs }),
        });
        return { ...plan, usedConnectionCredential: Boolean(connectionToken) };
      },
      buildConnectParams(plan) {
        return {
          minProtocol: PROTOCOL_VERSION,
          maxProtocol: PROTOCOL_VERSION,
          client: clientInfo,
          role: plan.role,
          scopes: plan.scopes,
          ...(plan.device ? { device: plan.device } : {}),
          ...(plan.auth ? { auth: plan.auth } : {}),
        };
      },
      onConnectHello: (hello, context) => {
        void this.auth.acceptHello(hello, context.plan)
          .then(async () => {
            if (context.plan.usedConnectionCredential) {
              await clearConnectionCredential(options.url);
            }
          })
          .catch((error: unknown) => {
            this.setState("error", connectionDetail(error));
          });
      },
      onHello: (hello) => {
        this.setState("connected");
        options.onHello?.(hello);
      },
      onConnectFailure: (failure) => {
        const pause = shouldPauseGatewayReconnect({
          details: failure.details,
          protocolMismatchIsTerminal: true,
          clientVersionMismatchIsTerminal: true,
        });
        const pairing = failure.code === "PAIRING_REQUIRED" || failure.gatewayCode === "PAIRING_REQUIRED";
        this.setState(pairing ? "pairing" : "error", connectionDetail(failure));
        return {
          closeCode: 4000,
          closeReason: "connect failed",
          ...(pause ? { stop: true } : {}),
          error: failure,
        };
      },
      resolveClose: (context) => {
        const failure = context.connectFailure?.error;
        const pause = failure instanceof GatewayProtocolRequestError
          ? shouldPauseGatewayReconnect({
            details: failure.details,
            protocolMismatchIsTerminal: true,
            clientVersionMismatchIsTerminal: true,
          })
          : false;
        return { retry: !pause, notify: true, ...(failure ? { pendingError: failure } : {}) };
      },
      onClose: (_context, decision) => {
        if (this.state === "connected") this.setState(decision.retry ? "connecting" : "disconnected");
      },
      onConnectError: (error) => this.setState("error", connectionDetail(error)),
      onSocketFactoryError: (error) => this.setState("error", connectionDetail(error)),
      onEvent: (event) => options.onEvent?.(event),
      handshake: { mode: "require-challenge", timeoutMs: 15_000 },
      reconnect: { initialMs: 1_000, multiplier: 2, maxMs: 30_000 },
      requestTimeoutMs: 30_000,
    });
  }

  start(): void {
    this.setState("connecting");
    this.client.start();
  }

  stop(): void {
    this.client.stop();
    this.setState("disconnected");
  }

  reconnect(): void {
    this.client.stop();
    this.setState("connecting");
    this.client.start();
  }

  request<T>(
    method: string,
    params: Record<string, unknown> = {},
    options?: GatewayProtocolRequestOptions,
  ): Promise<T> {
    return this.client.request<T>(method, params, options);
  }

  get connected(): boolean {
    return this.client.connected;
  }

  private setState(state: GatewayConnectionState, detail?: string): void {
    this.state = state;
    this.options.onStateChange?.(state, detail);
  }
}
