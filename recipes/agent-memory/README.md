# Agent Memory

Persist structured facts across agent sessions using PerSQL as the memory backend.

The agent can save, recall, and forget named memories — schema details, user preferences, project decisions — that survive process restarts and are shared across agent instances.

## Pattern

1. On startup, load the full memory index into the system prompt so the model answers known questions without a tool call.
2. Give the agent `remember_memory`, `recall_memory`, and `forget_memory` tools for managing the store at runtime.
3. The memory database is a regular PerSQL database — one per agent, team, or project, as needed.

## Implementations

| Language | Framework | File |
|---|---|---|
| TypeScript | OpenAI Agents SDK | [typescript/](typescript/) |
| Python | OpenAI Agents SDK | [python/](python/) |

## What you'll see

```
> What do you know about the widgets table?
The widgets table has: id INTEGER PRIMARY KEY, name TEXT, price REAL, in_stock INTEGER.

> Remember that our staging database is called "widgets-staging".
Saved memory: staging-db-name

> What's the staging database called?
It's called "widgets-staging".   ← answered from memory, no tool call
```
