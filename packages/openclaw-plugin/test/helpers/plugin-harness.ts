import type {
  OpenClawPluginApi,
  PluginAgentEventSubscriptionRegistration,
} from "openclaw/plugin-sdk/core";
import type { AsrProvider } from "../../src/asr-provider.js";
import type { JournalProvider } from "../../src/journal-provider.js";
import { registerOpenClawPets, type PetsPluginApi } from "../../src/plugin.js";
import type { TodoSummarizer } from "../../src/todo-summarizer.js";
import type { UtteranceClassifier } from "../../src/utterance-classifier.js";

export type GatewayHandler = Parameters<OpenClawPluginApi["registerGatewayMethod"]>[1];
type PluginService = Parameters<OpenClawPluginApi["registerService"]>[0];
type MemorySupplement = Parameters<OpenClawPluginApi["registerMemoryCorpusSupplement"]>[0];

export function createApi(
  stateDirectory: string,
  options: {
    asr?: AsrProvider;
    journal?: JournalProvider;
    classifier?: UtteranceClassifier;
    todoSummarizer?: TodoSummarizer;
  } = {},
) {
  const methods = new Map<string, GatewayHandler>();
  let service: PluginService | undefined;
  let agentEventSubscription: PluginAgentEventSubscriptionRegistration | undefined;
  let memorySupplement: MemorySupplement | undefined;
  const api: PetsPluginApi = {
    pluginConfig: {
      storagePath: stateDirectory,
      contextInjection: { enabled: true, maxItems: 2 },
      routing: {
        default: "confirm",
        contextPrefixes: ["记录一下", "note:"],
        agentPrefixes: ["帮我", "ask:"],
        targetAgentId: "main",
      },
    },
    resolvePath: (value: string) => value,
    registerGatewayMethod: (name: string, handler: GatewayHandler) => methods.set(name, handler),
    registerMemoryCorpusSupplement: (supplement) => { memorySupplement = supplement; },
    registerMemoryPromptPreparation: () => undefined,
    registerService: (registered: typeof service) => { service = registered; },
    agent: {
      events: {
        registerAgentEventSubscription: (subscription: PluginAgentEventSubscriptionRegistration) => {
          agentEventSubscription = subscription;
        },
        emitAgentEvent: () => ({ emitted: false, reason: "test harness" }),
      },
    },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  };
  registerOpenClawPets(api, options);
  return {
    methods,
    get service() { return service; },
    get agentEventSubscription() { return agentEventSubscription; },
    get memorySupplement() { return memorySupplement; },
  };
}

export async function request(
  methods: Map<string, GatewayHandler>,
  name: string,
  params: Record<string, unknown> = {},
) {
  const handler = methods.get(name);
  if (!handler) throw new Error(`missing method ${name}`);
  let response: { ok: boolean; payload?: unknown; error?: unknown } | undefined;
  await handler({
    params,
    respond: (ok, payload, error) => { response = { ok, payload, error }; },
  } as Parameters<GatewayHandler>[0]);
  return response;
}

export async function deliverAgentEvent(
  subscription: PluginAgentEventSubscriptionRegistration | undefined,
  event: Parameters<PluginAgentEventSubscriptionRegistration["handle"]>[0],
): Promise<void> {
  await subscription?.handle(event, {
    getRunContext: () => undefined,
    setRunContext: () => undefined,
    clearRunContext: () => undefined,
  });
}
