import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isActivityObservation, type ActivityObservation } from "@openclaw-pets/protocol";
import type { JournalPageOptions, JournalProvider, JournalSearchResult } from "./journal-provider.js";

function queryTerms(query: string): string[] {
  return [...new Set(query.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 1))];
}

function scoreObservation(observation: ActivityObservation, terms: string[]): number {
  if (terms.length === 0) return 1;
  const text = `${observation.text} ${(observation.tags ?? []).join(" ")}`.toLocaleLowerCase();
  const hits = terms.filter((term) => text.includes(term)).length;
  return hits === 0 ? 0 : hits / terms.length;
}

function isContextObservation(observation: ActivityObservation): boolean {
  return observation.route === undefined || observation.route === "context";
}

export class ActivityStore implements JournalProvider {
  readonly kind = "local" as const;
  private readonly filePath: string;
  private loadPromise: Promise<void> | undefined;
  private readonly observations = new Map<string, ActivityObservation>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly directory: string) {
    this.filePath = join(directory, "activities.jsonl");
  }

  private async load(): Promise<void> {
    this.loadPromise ??= this.loadFromDisk();
    await this.loadPromise;
  }

  private async loadFromDisk(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    let contents = "";
    try {
      contents = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (!(error instanceof Error) || !Reflect.has(error, "code") || Reflect.get(error, "code") !== "ENOENT") throw error;
    }
    for (const line of contents.split("\n")) {
      if (!line.trim()) continue;
      try {
        const observation: unknown = JSON.parse(line);
        if (isActivityObservation(observation)) this.observations.set(observation.id, observation);
      } catch {
        // Keep later valid records readable when one line is damaged.
      }
    }
  }

  private enqueueWrite<T>(write: () => Promise<T>): Promise<T> {
    const operation = this.writeChain.then(write);
    this.writeChain = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async append(observation: ActivityObservation): Promise<{ inserted: boolean; observation: ActivityObservation }> {
    await this.load();
    return this.enqueueWrite(async () => {
      const existing = this.observations.get(observation.id);
      if (existing) return { inserted: false, observation: existing };
      await appendFile(this.filePath, `${JSON.stringify(observation)}\n`, { encoding: "utf8", mode: 0o600 });
      this.observations.set(observation.id, observation);
      return { inserted: true, observation };
    });
  }

  async delete(id: string): Promise<boolean> {
    await this.load();
    return this.enqueueWrite(async () => {
      if (!this.observations.has(id)) return false;
      const temporaryPath = `${this.filePath}.tmp`;
      const remaining = [...this.observations.values()].filter((observation) => observation.id !== id);
      const contents = remaining.map((observation) => JSON.stringify(observation)).join("\n");
      await writeFile(temporaryPath, contents ? `${contents}\n` : "", { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
      this.observations.delete(id);
      return true;
    });
  }

  async retract(id: string): Promise<boolean> {
    return this.delete(id);
  }

  async get(id: string): Promise<ActivityObservation | null> {
    await this.load();
    await this.writeChain;
    return this.observations.get(id) ?? null;
  }

  async getContext(id: string): Promise<ActivityObservation | null> {
    const observation = await this.get(id);
    return observation && isContextObservation(observation) ? observation : null;
  }

  async list(options: { limit: number; agentId?: string; sessionKey?: string }): Promise<ActivityObservation[]> {
    await this.load();
    await this.writeChain;
    return [...this.observations.values()]
      .filter((observation) => !options.agentId || !observation.agentId || observation.agentId === options.agentId)
      .filter((observation) => !options.sessionKey || !observation.sessionKey || observation.sessionKey === options.sessionKey)
      .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
      .slice(0, options.limit);
  }

  async page(options: JournalPageOptions) {
    const all = await this.list({
      limit: Number.MAX_SAFE_INTEGER,
      ...(options.agentId ? { agentId: options.agentId } : {}),
      ...(options.sessionKey ? { sessionKey: options.sessionKey } : {}),
    }).then((items) => items
      .filter((item) => !options.startAt || Date.parse(item.occurredAt) >= Date.parse(options.startAt))
      .filter((item) => !options.endAt || Date.parse(item.occurredAt) < Date.parse(options.endAt)));
    const cursorIndex = options.cursor ? all.findIndex((item) => item.id === options.cursor) : -1;
    const start = options.cursor ? cursorIndex + 1 : 0;
    if (options.cursor && cursorIndex < 0) {
      return {
        status: "partial" as const,
        observations: [],
        gaps: [{ source: "journal", reason: "Activity cursor is no longer available" }],
      };
    }
    const observations = all.slice(start, start + options.limit);
    const finalItem = observations.at(-1);
    return {
      status: "ok" as const,
      observations,
      gaps: [],
      ...(finalItem && start + observations.length < all.length ? { nextCursor: finalItem.id } : {}),
    };
  }

  async search(query: string, limit: number): Promise<JournalSearchResult[]> {
    return this.searchContext(query, limit);
  }

  async listContext(options: { limit: number; agentId?: string; sessionKey?: string }): Promise<ActivityObservation[]> {
    const observations = await this.list({
      limit: Number.MAX_SAFE_INTEGER,
      ...(options.agentId ? { agentId: options.agentId } : {}),
      ...(options.sessionKey ? { sessionKey: options.sessionKey } : {}),
    });
    return observations.filter(isContextObservation).slice(0, options.limit);
  }

  async searchContext(query: string, limit: number): Promise<JournalSearchResult[]> {
    await this.load();
    await this.writeChain;
    const terms = queryTerms(query);
    return [...this.observations.values()]
      .filter(isContextObservation)
      .map((observation) => ({ ...observation, score: scoreObservation(observation, terms) }))
      .filter((observation) => observation.score > 0)
      .sort((left, right) => right.score - left.score || Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
      .slice(0, limit);
  }
}
