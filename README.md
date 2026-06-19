# PerSQL Cookbook

Practical recipes for building agents and applications with [PerSQL](https://persql.com).

Each recipe is self-contained, ships TypeScript and/or Python implementations, and runs against a real PerSQL database.

## Recipes

| Recipe | Languages | What it shows |
|---|---|---|
| [agent-memory](recipes/agent-memory/) | TS · Py | Persistent structured memory (FTS5) across agent sessions, with the OpenAI Agents SDK |
| [langgraph-checkpointer](recipes/langgraph-checkpointer/) | TS · Py | LangGraph agent state persisted across restarts via the PerSQL checkpointer |
| [openai-agents-session](recipes/openai-agents-session/) | TS · Py | OpenAI Agents SDK conversation history persisted via a PerSQL session |
| [google-adk-session](recipes/google-adk-session/) | Py | Google ADK sessions, events, and state on a PerSQL session service |
| [agent-framework-history](recipes/agent-framework-history/) | Py | Microsoft Agent Framework message history on a PerSQL history provider |
| [strands-session](recipes/strands-session/) | Py | AWS Strands sessions, agents, and messages on a PerSQL session store |
| [drizzle](recipes/drizzle/) | TS | Drizzle ORM query builder against a PerSQL database via the sqlite-proxy driver |
| [kysely](recipes/kysely/) | TS | Kysely typed SQL, with `db.transaction()` shipped as one batched round-trip |
| [prisma](recipes/prisma/) | TS | Prisma Client pointed at a PerSQL database through the driver adapter |

## Prerequisites

- A PerSQL account and token — [console.persql.com](https://console.persql.com)
- Node 20+ for TypeScript recipes
- Python 3.11+ for Python recipes

## Running a recipe

Every recipe directory has its own `README.md` with exact steps.

```sh
# TypeScript
cd recipes/<name>/typescript
cp .env.example .env   # add PERSQL_TOKEN and PERSQL_DATABASE
npm install
npm start

# Python
cd recipes/<name>/python
cp .env.example .env
uv sync            # some recipes: `uv sync --extra interactive` to run the agent
uv run python main.py
```

Each recipe also ships a headless `ci.ts` / `ci.py` that runs without input — local in-process SQLite by default, or against a real PerSQL database (a fresh branch per run) when `PERSQL_TOKEN` is set. These are what CI exercises.
