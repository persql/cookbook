# PerSQL Cookbook

Practical recipes for building agents and applications with [PerSQL](https://persql.com).

Each recipe is self-contained, has TypeScript and Python implementations, and runs against a real PerSQL database.

## Recipes

| Recipe | What it shows |
|---|---|
| [agent-memory](recipes/agent-memory/) | Persistent structured memory across agent sessions using `@persql/context` / PerSQL Python SDK |

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
uv sync
uv run python main.py
```
