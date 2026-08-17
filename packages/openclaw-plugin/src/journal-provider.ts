import type {
  ActivityObservation,
  ActivityPage,
  JournalUpdateRequest,
  JournalUpdateResult,
} from "@openclaw-pets/protocol";

export type JournalSearchResult = ActivityObservation & { score: number };

export type JournalPageOptions = {
  limit: number;
  cursor?: string;
  startAt?: string;
  endAt?: string;
  agentId?: string;
  sessionKey?: string;
};

export interface JournalProvider {
  readonly kind: "local" | "http";
  append(observation: ActivityObservation): Promise<{ inserted: boolean; observation: ActivityObservation }>;
  update(request: JournalUpdateRequest): Promise<JournalUpdateResult>;
  retract(id: string): Promise<boolean>;
  page(options: JournalPageOptions): Promise<ActivityPage>;
  getContext(id: string): Promise<ActivityObservation | null>;
  listContext(options: { limit: number; agentId?: string; sessionKey?: string }): Promise<ActivityObservation[]>;
  searchContext(query: string, limit: number): Promise<JournalSearchResult[]>;
}
