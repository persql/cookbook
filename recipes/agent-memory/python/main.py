"""Agent with persistent memory backed by PerSQL.

Mirrors the TypeScript recipe: full memory bodies are injected into the
system prompt so the model answers known questions directly, with
remember/recall/forget tools for runtime management.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from uuid import uuid4

from dotenv import load_dotenv
from agents import Agent, Runner, function_tool
from persql import PerSQL

load_dotenv()

PERSQL_TOKEN = os.environ["PERSQL_TOKEN"]
PERSQL_DATABASE = os.environ["PERSQL_DATABASE"]
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")


# ---------------------------------------------------------------------------
# Memory store — thin wrapper over the PerSQL Python SDK.
# Mirrors the schema of @persql/context so the same database is readable
# from TypeScript and Python agents.
# ---------------------------------------------------------------------------

class MemoryStore:
    """Structured memory store backed by a PerSQL database.

    Schema matches @persql/context so TypeScript and Python agents can
    share the same memory database.
    """

    def __init__(self, token: str, database: str) -> None:
        self._client = PerSQL(token=token)
        self._db = self._client.database(database)
        self._ready = False

    def init(self) -> None:
        """Create the schema (idempotent). Call once before first use."""
        if self._ready:
            return
        self._db.batch(
            [
                {
                    "sql": (
                        "CREATE TABLE IF NOT EXISTS ctx_memory ("
                        "  id TEXT PRIMARY KEY,"
                        "  name TEXT UNIQUE NOT NULL,"
                        "  description TEXT NOT NULL DEFAULT '',"
                        "  type TEXT NOT NULL DEFAULT 'project',"
                        "  body TEXT NOT NULL,"
                        "  source TEXT,"
                        "  created_at INTEGER NOT NULL,"
                        "  updated_at INTEGER NOT NULL"
                        ")"
                    )
                },
                {
                    "sql": (
                        "CREATE VIRTUAL TABLE IF NOT EXISTS ctx_memory_fts"
                        " USING fts5("
                        "  name, description, body,"
                        "  content=ctx_memory, content_rowid=rowid,"
                        "  tokenize='porter unicode61'"
                        ")"
                    )
                },
                # Keep FTS in sync with the main table.
                {
                    "sql": (
                        "CREATE TRIGGER IF NOT EXISTS ctx_memory_ai"
                        " AFTER INSERT ON ctx_memory BEGIN"
                        "  INSERT INTO ctx_memory_fts(rowid, name, description, body)"
                        "  VALUES (new.rowid, new.name, new.description, new.body);"
                        " END"
                    )
                },
                {
                    "sql": (
                        "CREATE TRIGGER IF NOT EXISTS ctx_memory_ad"
                        " AFTER DELETE ON ctx_memory BEGIN"
                        "  INSERT INTO ctx_memory_fts(ctx_memory_fts, rowid, name, description, body)"
                        "  VALUES ('delete', old.rowid, old.name, old.description, old.body);"
                        " END"
                    )
                },
                {
                    "sql": (
                        "CREATE TRIGGER IF NOT EXISTS ctx_memory_au"
                        " AFTER UPDATE ON ctx_memory BEGIN"
                        "  INSERT INTO ctx_memory_fts(ctx_memory_fts, rowid, name, description, body)"
                        "  VALUES ('delete', old.rowid, old.name, old.description, old.body);"
                        "  INSERT INTO ctx_memory_fts(rowid, name, description, body)"
                        "  VALUES (new.rowid, new.name, new.description, new.body);"
                        " END"
                    )
                },
            ],
            transaction=False,
        )
        self._ready = True

    def remember(self, name: str, description: str, body: str, type: str = "project") -> None:
        """UPSERT a named memory. Same name → update."""
        now = int(time.time() * 1000)
        self._db.query(
            "INSERT INTO ctx_memory (id, name, description, type, body, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)"
            " ON CONFLICT(name) DO UPDATE SET"
            "   description = excluded.description,"
            "   body        = excluded.body,"
            "   type        = excluded.type,"
            "   updated_at  = excluded.updated_at",
            [f"m_{uuid4().hex}", name, description, type, body, now, now],
        )

    def recall(self, query: str, limit: int = 10) -> list[dict]:
        """BM25-ranked keyword search. Returns full rows including body."""
        if not query.strip():
            return self.index(limit=limit)
        result = self._db.query(
            "SELECT name, description, type, body FROM ctx_memory_fts"
            " WHERE ctx_memory_fts MATCH ? ORDER BY rank LIMIT ?",
            [query, limit],
        )
        return result["data"]

    def forget(self, name: str) -> None:
        """Hard-delete a memory by name."""
        self._db.query("DELETE FROM ctx_memory WHERE name = ?", [name])

    def index(self, limit: int = 50) -> list[dict]:
        """Name + description + type for all memories, newest first."""
        result = self._db.query(
            "SELECT name, description, type, body FROM ctx_memory"
            " ORDER BY updated_at DESC LIMIT ?",
            [limit],
        )
        return result["data"]


# ---------------------------------------------------------------------------
# Tool factory — closures bind the store without globals.
# ---------------------------------------------------------------------------

def make_memory_tools(store: MemoryStore):
    @function_tool
    def remember_memory(name: str, description: str, body: str, type: str = "project") -> str:
        """Save or update a named memory. Use for facts worth keeping across sessions:
        schema details, user preferences, project decisions. Same name overwrites."""
        store.remember(name=name, description=description, body=body, type=type)
        return json.dumps({"saved": name})

    @function_tool
    def recall_memory(query: str, limit: int = 10) -> str:
        """Search memories by keyword (BM25-ranked). Use when the answer might be
        in memory before querying a live data source."""
        rows = store.recall(query, limit=limit)
        return json.dumps({"memories": rows})

    @function_tool
    def forget_memory(name: str) -> str:
        """Delete a saved memory by name."""
        store.forget(name)
        return json.dumps({"deleted": name})

    return [remember_memory, recall_memory, forget_memory]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main() -> None:
    store = MemoryStore(token=PERSQL_TOKEN, database=PERSQL_DATABASE)
    store.init()

    # Inject full memory bodies so the model can answer without a tool call.
    memories = store.index()
    if memories:
        mem_section = "\n\n".join(
            f"[{m['type']}] {m['name']}\n{m['description']}\n---\n{m['body']}"
            for m in memories
        )
    else:
        mem_section = "No memories saved yet."

    agent = Agent(
        name="assistant",
        model=OPENAI_MODEL,
        instructions=f"""You are a helpful assistant with persistent memory.

MEMORIES — facts saved from previous sessions. Answer questions covered here \
directly without calling any tool first:

{mem_section}

Use remember_memory to save new facts worth keeping (schema details, preferences, decisions).
Use recall_memory to search for something not shown above.
Use forget_memory to remove stale entries.""",
        tools=make_memory_tools(store),
    )

    print('Agent ready. Type a message or "exit" to quit.\n')
    while True:
        user_input = input("> ").strip()
        if user_input.lower() == "exit":
            break
        result = await Runner.run(agent, user_input)
        print(f"\n{result.final_output}\n")


if __name__ == "__main__":
    asyncio.run(main())
