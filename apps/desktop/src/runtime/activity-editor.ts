import {
  PETS_RPC,
  type ActivityObservation,
  type JournalUpdateResult,
} from "@openclaw-pets/protocol";

type GatewayRequest = <T>(method: string, params: Record<string, unknown>) => Promise<T>;

export class ActivityEditConflictError extends Error {
  constructor(readonly current: ActivityObservation) {
    super("Activity was edited by another device");
    this.name = "ActivityEditConflictError";
  }
}

export async function saveActivityEdit(
  request: GatewayRequest,
  observation: ActivityObservation,
  text: string,
): Promise<ActivityObservation> {
  const normalized = text.trim();
  if (!normalized) throw new Error("Activity text cannot be empty");
  if (!observation.revision) throw new Error("Activity revision is unavailable; refresh before editing");
  const result = await request<JournalUpdateResult>(PETS_RPC.activityUpdate, {
    id: observation.id,
    text: normalized,
    expectedRevision: observation.revision,
  });
  if (result.status === "updated") return result.observation;
  if (result.status === "conflict") throw new ActivityEditConflictError(result.observation);
  throw new Error("Activity no longer exists");
}
