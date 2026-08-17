import {
  PETS_PROTOCOL_VERSION,
  type PetSemanticState,
  type PetStatus,
} from "@openclaw-pets/protocol";

type ProjectionItem = {
  detail?: string;
  order: number;
};

type RunProjection = {
  runId: string;
  sessionKey?: string;
  interactionId: string;
  state: Extract<PetSemanticState, "thinking" | "working" | "needs_input">;
  detail?: string;
  order: number;
  activeTools: Map<string, ProjectionItem>;
  pendingApprovals: Map<string, ProjectionItem>;
};

type InteractionProjection = {
  interactionId: string;
  runs: Map<string, RunProjection>;
  terminalState: Extract<PetSemanticState, "idle" | "succeeded" | "failed">;
  terminalTimer?: ReturnType<typeof setTimeout>;
};

const priority: Record<RunProjection["state"], number> = {
  thinking: 10,
  working: 20,
  needs_input: 30,
};

export class PetStateProjector {
  private readonly interactions = new Map<string, InteractionProjection>();
  private readonly interactionByRun = new Map<string, string>();
  private revision = 0;
  private order = 0;
  private readonly listeners = new Set<(status: PetStatus) => void>();

  constructor(
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly terminalDurationMs = 3_000,
  ) {}

  subscribe(listener: (status: PetStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  beginRun(input: { runId: string; sessionKey?: string; interactionId: string }): void {
    const interaction = this.getOrCreateInteraction(input.interactionId);
    this.clearTerminalTimer(interaction);
    interaction.runs.set(input.runId, {
      ...input,
      state: "thinking",
      order: ++this.order,
      activeTools: new Map(),
      pendingApprovals: new Map(),
    });
    this.interactionByRun.set(input.runId, input.interactionId);
    interaction.terminalState = "idle";
    this.changed(input.interactionId);
  }

  beginTool(input: { runId: string; sessionKey?: string; toolCallId: string; toolName?: string }): void {
    const run = this.run(input.runId);
    if (!run) return;
    run.activeTools.set(input.toolCallId, {
      ...(input.toolName ? { detail: input.toolName } : {}),
      order: ++this.order,
    });
    this.refreshRun(run);
    this.changed(run.interactionId);
  }

  endTool(input: { runId: string; toolCallId: string }): void {
    const run = this.run(input.runId);
    if (!run?.activeTools.delete(input.toolCallId)) return;
    this.refreshRun(run);
    this.changed(run.interactionId);
  }

  requireInput(input: { runId: string; sessionKey?: string; approvalId: string; detail?: string }): void {
    const run = this.run(input.runId);
    if (!run) return;
    run.pendingApprovals.set(input.approvalId, {
      ...(input.detail ? { detail: input.detail } : {}),
      order: ++this.order,
    });
    this.refreshRun(run);
    this.changed(run.interactionId);
  }

  resolveInput(input: { runId: string; approvalId: string }): void {
    const run = this.run(input.runId);
    if (!run?.pendingApprovals.delete(input.approvalId)) return;
    this.refreshRun(run);
    this.changed(run.interactionId);
  }

  endRun(input: { runId: string; success: boolean }): void {
    const interactionId = this.interactionByRun.get(input.runId);
    if (!interactionId) return;
    const interaction = this.interactions.get(interactionId);
    if (!interaction?.runs.delete(input.runId)) return;
    this.interactionByRun.delete(input.runId);
    if (interaction.runs.size === 0) {
      interaction.terminalState = input.success ? "succeeded" : "failed";
      this.clearTerminalTimer(interaction);
      interaction.terminalTimer = setTimeout(() => {
        delete interaction.terminalTimer;
        if (interaction.runs.size > 0 || interaction.terminalState === "idle") return;
        interaction.terminalState = "idle";
        this.changed(interactionId);
        this.interactions.delete(interactionId);
      }, this.terminalDurationMs);
    }
    this.changed(interactionId);
  }

  reset(): void {
    const interactionIds = [...this.interactions.keys()];
    for (const interaction of this.interactions.values()) this.clearTerminalTimer(interaction);
    this.interactions.clear();
    this.interactionByRun.clear();
    for (const interactionId of interactionIds) this.changed(interactionId);
  }

  snapshot(interactionId?: string): PetStatus {
    const interaction = interactionId ? this.interactions.get(interactionId) : undefined;
    const active = interaction
      ? [...interaction.runs.values()].sort((left, right) => {
        return priority[right.state] - priority[left.state] || right.order - left.order;
      })[0]
      : undefined;
    return {
      protocolVersion: PETS_PROTOCOL_VERSION,
      revision: this.revision,
      state: active?.state ?? interaction?.terminalState ?? "idle",
      changedAt: this.now(),
      ...(active?.sessionKey ? { sessionKey: active.sessionKey } : {}),
      ...(active?.runId ? { runId: active.runId } : {}),
      ...(active?.detail ? { detail: active.detail } : {}),
      ...(interactionId ? { interactionId } : {}),
    };
  }

  private getOrCreateInteraction(interactionId: string): InteractionProjection {
    const existing = this.interactions.get(interactionId);
    if (existing) return existing;
    const interaction: InteractionProjection = {
      interactionId,
      runs: new Map(),
      terminalState: "idle",
    };
    this.interactions.set(interactionId, interaction);
    return interaction;
  }

  private run(runId: string): RunProjection | undefined {
    const interactionId = this.interactionByRun.get(runId);
    return interactionId ? this.interactions.get(interactionId)?.runs.get(runId) : undefined;
  }

  private refreshRun(run: RunProjection): void {
    const pendingApproval = this.latest(run.pendingApprovals);
    const activeTool = this.latest(run.activeTools);
    run.state = pendingApproval ? "needs_input" : activeTool ? "working" : "thinking";
    const detail = pendingApproval?.detail ?? activeTool?.detail;
    if (detail) run.detail = detail;
    else delete run.detail;
    run.order = ++this.order;
  }

  private latest(items: Map<string, ProjectionItem>): ProjectionItem | undefined {
    return [...items.values()].sort((left, right) => right.order - left.order)[0];
  }

  private changed(interactionId: string): void {
    this.revision += 1;
    const status = this.snapshot(interactionId);
    for (const listener of this.listeners) listener(status);
  }

  private clearTerminalTimer(interaction: InteractionProjection): void {
    if (interaction.terminalTimer !== undefined) clearTimeout(interaction.terminalTimer);
    delete interaction.terminalTimer;
  }
}
