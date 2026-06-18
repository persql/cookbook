import { tool } from "@openai/agents";
import { z } from "zod";
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
    // FTS5 indexes name/description/body only; join back to the base
    // table to project non-indexed columns like `type`.
    const { data } = await this.db.query<MemoryRow>(
      "SELECT m.name, m.description, m.type, m.body FROM ctx_memory_fts" +
        " JOIN ctx_memory m ON m.rowid = ctx_memory_fts.rowid" +
        " WHERE ctx_memory_fts MATCH ? ORDER BY ctx_memory_fts.rank LIMIT ?",
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
    tool({
      name: "remember_memory",
      description:
        "Save or update a named memory. Use for facts worth keeping across sessions: schema details, user preferences, project decisions. Same name overwrites.",
      parameters: z.object({
        name: z.string().describe("Short kebab-case key"),
        description: z.string().describe("One-line summary"),
        type: z.enum(["user", "feedback", "project", "reference"]).default("project"),
        body: z.string().describe("Full content of the memory"),
      }),
      execute: async ({ name, description, type, body }) => {
        await store.remember({ name, description, type, body });
        return JSON.stringify({ saved: name });
      },
    }),
    tool({
      name: "recall_memory",
      description:
        "Search memories by keyword (BM25-ranked). Use when the answer might be in memory before querying a live data source.",
      parameters: z.object({
        query: z.string(),
        limit: z.number().int().positive().default(10),
      }),
      execute: async ({ query, limit }) => {
        const rows = await store.recall(query, limit);
        return JSON.stringify({ memories: rows });
      },
    }),
    tool({
      name: "forget_memory",
      description: "Delete a saved memory by name.",
      parameters: z.object({ name: z.string() }),
      execute: async ({ name }) => {
        await store.forget(name);
        return JSON.stringify({ deleted: name });
      },
    }),
  ];
}
