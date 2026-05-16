import { fail, ok, type ToolDefinition } from "./types";

/**
 * Notes are a simple persistent key/value store the agent can use as long-term
 * memory across executions. The backing store is supplied by the API layer
 * (in-memory Map or Mongo collection — both implement NotesStore).
 */
export interface NotesStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  list(): Promise<Array<{ key: string; value: string }>>;
  delete?(key: string): Promise<void>;
}

export function createNotesTools(store: NotesStore): ToolDefinition[] {
  const get: ToolDefinition = {
    name: "notes.get",
    description: "Retrieve a previously-saved note by key. Returns nothing if the key is unknown.",
    requiredScope: "notes:read",
    sensitive: false,
    parameters: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
      additionalProperties: false
    },
    async execute(args) {
      const key = String(args.key ?? "");
      if (!key) return fail("key is required");
      const value = await store.get(key);
      if (value === undefined) return ok(`no note for ${key}`, { found: false });
      return ok(`${key}: ${value}`, { found: true, value });
    }
  };

  const set: ToolDefinition = {
    name: "notes.set",
    description: "Save a note under a key. Overwrites any existing value.",
    requiredScope: "notes:write",
    sensitive: false,
    parameters: {
      type: "object",
      properties: { key: { type: "string" }, value: { type: "string" } },
      required: ["key", "value"],
      additionalProperties: false
    },
    async execute(args) {
      const key = String(args.key ?? "");
      const value = String(args.value ?? "");
      if (!key) return fail("key is required");
      await store.set(key, value);
      return ok(`saved ${key} (${value.length} chars)`, { key });
    }
  };

  const list: ToolDefinition = {
    name: "notes.list",
    description: "List all saved notes (keys with truncated values).",
    requiredScope: "notes:read",
    sensitive: false,
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      const all = await store.list();
      if (all.length === 0) return ok("no notes saved", { count: 0 });
      const summary = all.map(({ key, value }) => `- ${key}: ${value.slice(0, 80)}`).join("\n");
      return ok(summary, { count: all.length });
    }
  };

  return [get, set, list];
}

export class InMemoryNotesStore implements NotesStore {
  private readonly map = new Map<string, string>();

  async get(key: string) {
    return this.map.get(key);
  }

  async set(key: string, value: string) {
    this.map.set(key, value);
  }

  async list() {
    return Array.from(this.map.entries()).map(([key, value]) => ({ key, value }));
  }

  async delete(key: string) {
    this.map.delete(key);
  }

  /** Wipe all entries while keeping the same instance (so callers that already
   * captured a reference, like the ToolRouter, keep working after a reset). */
  clear() {
    this.map.clear();
  }
}
