/**
 * Lightweight memory store over @persql/sdk.
 *
 * Schema matches @persql/context so a TypeScript and Python agent can
 * share the same PerSQL database. Once @persql/context ships memoryTools()
 * on npm this file can be replaced with:
 *
 *   import { context, memoryTools } from "@persql/context";
 */

import type { PerSQLDatabase } from "@persql/sdk";

export type MemoryType = "user" | "feedback" | "project" | "reference";

export interface MemoryRow {
  name: string;
  description: string;
  type: MemoryType;
  body: string;
}

export class MemoryStore {
  private ready = false;

  constructor(private readonly db: PerSQLDatabase) {}

  async init(): Promise<void> {
    if (this.ready) return;
    await this.db.batch([
      {
        sql:
          "CREATE TABLE IF NOT EXISTS ctx_memory (" +
          "  id TEXT PRIMARY KEY," +
          "  name TEXT UNIQUE NOT NULL," +
          "  description TEXT NOT NULL DEFAULT ''," +
          "  type TEXT NOT NULL DEFAULT 'project'," +
          "  body TEXT NOT NULL," +
          "  source TEXT," +
          "  created_at INTEGER NOT NULL," +
          "  updated_at INTEGER NOT NULL" +
          ")",
      },
      {
        sql:
          "CREATE VIRTUAL TABLE IF NOT EXISTS ctx_memory_fts USING fts5(" +
          "  name, description, body," +
          "  content=ctx_memory, content_rowid=rowid," +
          "  tokenize='porter unicode61'" +
          ")",
      },
      {
        sql:
          "CREATE TRIGGER IF NOT EXISTS ctx_memory_ai AFTER INSERT ON ctx_memory BEGIN" +
          "  INSERT INTO ctx_memory_fts(rowid, name, description, body)" +
          "  VALUES (new.rowid, new.name, new.description, new.body); END",
      },
      {
        sql:
          "CREATE TRIGGER IF NOT EXISTS ctx_memory_ad AFTER DELETE ON ctx_memory BEGIN" +
          "  INSERT INTO ctx_memory_fts(ctx_memory_fts, rowid, name, description, body)" +
          "  VALUES ('delete', old.rowid, old.name, old.description, old.body); END",
      },
      {
        sql:
          "CREATE TRIGGER IF NOT EXISTS ctx_memory_au AFTER UPDATE ON ctx_memory BEGIN" +
          "  INSERT INTO ctx_memory_fts(ctx_memory_fts, rowid, name, description, body)" +
          "  VALUES ('delete', old.rowid, old.name, old.description, old.body);" +
          "  INSERT INTO ctx_memory_fts(rowid, name, description, body)" +
          "  VALUES (new.rowid, new.name, new.description, new.body); END",
      },
    ]);
    this.ready = true;
  }

  async remember(input: {
    name: string;
    description: string;
    body: string;
    type?: MemoryType;
  }): Promise<void> {
    const now = Date.now();
    const id = `m_${crypto.randomUUID().replace(/-/g, "")}`;
    await this.db.query(
      "INSERT INTO ctx_memory (id, name, description, type, body, created_at, updated_at)" +
        " VALUES (?, ?, ?, ?, ?, ?, ?)" +
        " ON CONFLICT(name) DO UPDATE SET" +
        "   description = excluded.description," +
        "   body        = excluded.body," +
        "   type        = excluded.type," +
        "   updated_at  = excluded.updated_at",
      [id, input.name, input.description, input.type ?? "project", input.body, now, now]
    );
  }

  async recall(query: string, limit = 10): Promise<MemoryRow[]> {
    if (!query.trim()) return this.index({ limit });
    const { data } = await this.db.query<MemoryRow>(
      "SELECT name, description, type, body FROM ctx_memory_fts" +
        " WHERE ctx_memory_fts MATCH ? ORDER BY rank LIMIT ?",
      [query, limit]
    );
    return data;
  }

  async forget(name: string): Promise<void> {
    await this.db.query("DELETE FROM ctx_memory WHERE name = ?", [name]);
  }

  async index(opts: { limit?: number } = {}): Promise<MemoryRow[]> {
    const { data } = await this.db.query<MemoryRow>(
      "SELECT name, description, type, body FROM ctx_memory" +
        " ORDER BY updated_at DESC LIMIT ?",
      [opts.limit ?? 50]
    );
    return data;
  }
}

export function makeMemoryTools(store: MemoryStore) {
  return [
    {
      type: "function" as const,
      name: "remember_memory",
      description:
        "Save or update a named memory. Use for facts worth keeping across sessions: schema details, user preferences, project decisions. Same name overwrites.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short kebab-case key" },
          description: { type: "string", description: "One-line summary" },
          type: {
            type: "string",
            enum: ["user", "feedback", "project", "reference"],
          },
          body: { type: "string", description: "Full content of the memory" },
        },
        required: ["name", "description", "body"],
        additionalProperties: false,
      },
      invoke: async (input: Record<string, unknown>) => {
        await store.remember({
          name: String(input.name),
          description: String(input.description),
          type: (input.type as MemoryType) ?? "project",
          body: String(input.body),
        });
        return { saved: input.name };
      },
    },
    {
      type: "function" as const,
      name: "recall_memory",
      description:
        "Search memories by keyword (BM25-ranked). Use when the answer might be in memory before querying a live data source.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      invoke: async (input: Record<string, unknown>) => {
        const rows = await store.recall(
          String(input.query),
          typeof input.limit === "number" ? input.limit : 10
        );
        return { memories: rows };
      },
    },
    {
      type: "function" as const,
      name: "forget_memory",
      description: "Delete a saved memory by name.",
      parameters: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
        additionalProperties: false,
      },
      invoke: async (input: Record<string, unknown>) => {
        await store.forget(String(input.name));
        return { deleted: input.name };
      },
    },
  ];
}
