import {
  isActivityObservation,
  type ActivityObservation,
  type ActivityPage,
  type JournalUpdateRequest,
  type JournalUpdateResult,
} from "@openclaw-pets/protocol";
import type {
  JournalPageOptions,
  JournalProvider,
  JournalSearchResult,
} from "./journal-provider.js";

export type HttpJournalProviderConfig = {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Journal Provider returned an invalid response");
  }
  return value as JsonRecord;
}

function observations(value: unknown): ActivityObservation[] {
  if (!Array.isArray(value) || value.some((item) => !isActivityObservation(item))) {
    throw new Error("Journal Provider returned invalid observations");
  }
  return value;
}

function pageResponse(value: unknown): ActivityPage {
  const body = record(value);
  if (body.status !== "ok" && body.status !== "partial" && body.status !== "unavailable") {
    throw new Error("Journal Provider returned an invalid status");
  }
  const gaps = Array.isArray(body.gaps) ? body.gaps.map((item) => {
    const gap = record(item);
    if (typeof gap.source !== "string" || typeof gap.reason !== "string") {
      throw new Error("Journal Provider returned an invalid gap");
    }
    return { source: gap.source, reason: gap.reason };
  }) : [];
  return {
    status: body.status,
    observations: observations(body.observations),
    gaps,
    ...(typeof body.nextCursor === "string" ? { nextCursor: body.nextCursor } : {}),
  };
}

function updateResponse(value: unknown): JournalUpdateResult {
  const body = record(value);
  if (body.status === "not_found") return { status: "not_found" };
  if ((body.status !== "updated" && body.status !== "conflict")
    || !isActivityObservation(body.observation)) {
    throw new Error("Journal Provider returned an invalid update response");
  }
  return { status: body.status, observation: body.observation };
}

export class HttpJournalProvider implements JournalProvider {
  readonly kind = "http" as const;
  private readonly baseUrl: string;

  constructor(
    private readonly config: HttpJournalProviderConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.baseUrl = config.baseUrl.replace(/\/+$/u, "");
  }

  private async request(operation: string, body: JsonRecord): Promise<unknown> {
    if (!this.config.apiKey) throw new Error("Remote Journal credential is unavailable");
    const response = await this.fetcher(`${this.baseUrl}/v1/journal-provider/v1/${operation}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    if (!response.ok) throw new Error(`Remote Journal request failed with HTTP ${response.status}`);
    return response.json();
  }

  async append(observation: ActivityObservation) {
    const body = record(await this.request("append", { observation }));
    if (typeof body.inserted !== "boolean" || !isActivityObservation(body.observation)) {
      throw new Error("Journal Provider returned an invalid append response");
    }
    return { inserted: body.inserted, observation: body.observation };
  }

  async update(request: JournalUpdateRequest): Promise<JournalUpdateResult> {
    return updateResponse(await this.request("update", request));
  }

  async retract(id: string): Promise<boolean> {
    const body = record(await this.request("retract", { id }));
    if (typeof body.retracted !== "boolean") throw new Error("Journal Provider returned an invalid retract response");
    return body.retracted;
  }

  async page(options: JournalPageOptions): Promise<ActivityPage> {
    try {
      return pageResponse(await this.request("page", options));
    } catch {
      return {
        status: "unavailable",
        observations: [],
        gaps: [{ source: "journal", reason: "Remote Journal is unavailable" }],
      };
    }
  }

  async getContext(id: string): Promise<ActivityObservation | null> {
    const body = record(await this.request("get-context", { id }));
    if (body.observation === null) return null;
    if (!isActivityObservation(body.observation)) throw new Error("Journal Provider returned an invalid observation");
    return body.observation;
  }

  async listContext(options: { limit: number; agentId?: string; sessionKey?: string }): Promise<ActivityObservation[]> {
    const body = record(await this.request("list-context", options));
    return observations(body.observations);
  }

  async searchContext(query: string, limit: number): Promise<JournalSearchResult[]> {
    const body = record(await this.request("search-context", { query, limit }));
    if (!Array.isArray(body.results)) throw new Error("Journal Provider returned invalid search results");
    return body.results.map((item) => {
      const result = record(item);
      const { score, ...observation } = result;
      if (!isActivityObservation(observation) || typeof score !== "number" || !Number.isFinite(score)) {
        throw new Error("Journal Provider returned an invalid search result");
      }
      return { ...observation, score };
    });
  }
}
