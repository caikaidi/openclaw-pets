import type { PetSemanticState, PetStatus } from "@openclaw-pets/protocol";

export type InteractionDisplayState = Exclude<PetSemanticState, "offline" | "idle">;

export function resolveDisplayState(input: {
  connected: boolean;
  backendState?: PetSemanticState;
  interactionState?: InteractionDisplayState;
}): PetSemanticState {
  if (!input.connected) return "offline";
  if (input.interactionState) return input.interactionState;
  return input.backendState ?? "idle";
}

export function shouldApplyInteractionStatus(
  activeInteractionId: string | undefined,
  status: { interactionId: PetStatus["interactionId"] | undefined },
): boolean {
  return activeInteractionId !== undefined && status.interactionId === activeInteractionId;
}
