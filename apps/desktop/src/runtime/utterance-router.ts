import type {
  ActivityObservation,
  UtteranceRoute,
  UtteranceRouteResult,
} from "@openclaw-pets/protocol";
import { PETS_RPC } from "@openclaw-pets/protocol";

export type GatewayRequest = <T>(method: string, params: Record<string, unknown>) => Promise<T>;

export type SubmitUtteranceOptions = {
  text: string;
  actionText?: string;
  interactionId: string;
  asrProvider: string;
  requestedRoute?: UtteranceRoute;
  now?: () => string;
  createId?: () => string;
};

export type SubmitUtteranceResult =
  | { kind: "context"; inserted: boolean; observation: ActivityObservation }
  | { kind: "agent"; sessionKey: string; runId?: string }
  | { kind: "confirm"; text: string; transcript: string };

type ActivityAppendResponse = { inserted: boolean; observation?: ActivityObservation };
type SessionCreateResponse = { ok?: boolean; key?: string; runId?: string };

function labelFromText(text: string): string {
  return text.replace(/\s+/gu, " ").trim().slice(0, 120);
}

export async function submitUtterance(
  request: GatewayRequest,
  options: SubmitUtteranceOptions,
): Promise<SubmitUtteranceResult> {
  const text = options.text.trim();
  if (!text) throw new Error("Utterance text is empty");
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? (() => crypto.randomUUID());
  const route = await request<UtteranceRouteResult>(PETS_RPC.utteranceRoute, {
    text,
    ...(options.requestedRoute ? { requestedRoute: options.requestedRoute } : {}),
  });
  const actionText = options.actionText?.trim() || route.text.trim();
  if (!actionText) throw new Error("The configured route removed the entire utterance");

  const needsConfirmation = route.route === "confirm";
  if (needsConfirmation) return { kind: "confirm", text: actionText, transcript: text };

  const agentId = route.route === "agent" ? route.targetAgentId ?? "main" : undefined;
  const sessionKey = route.route === "agent"
    ? `agent:${agentId}:pets:${options.interactionId}`
    : undefined;
  const observation: ActivityObservation = {
    id: createId(),
    occurredAt: now(),
    source: "voice",
    text,
    asrProvider: options.asrProvider,
    route: route.route,
    interactionId: options.interactionId,
  };
  const appended = await request<ActivityAppendResponse>(PETS_RPC.activityAppend, { observation });

  if (route.route === "context") {
    return { kind: "context", inserted: appended.inserted, observation: appended.observation ?? observation };
  }

  const created = await request<SessionCreateResponse>("sessions.create", {
    key: sessionKey,
    agentId,
    label: labelFromText(actionText),
    visibility: "shared",
    message: actionText,
  });
  if (created.ok !== true || !created.key) throw new Error("OpenClaw did not create the requested session");
  return {
    kind: "agent",
    sessionKey: created.key,
    ...(created.runId ? { runId: created.runId } : {}),
  };
}
