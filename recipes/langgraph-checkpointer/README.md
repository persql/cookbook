# LangGraph Checkpointer

Persist LangGraph agent state across process restarts using PerSQL as the
checkpointer backend.

A LangGraph checkpointer saves the graph's state once per super-step, keyed by
`thread_id`. Back it with PerSQL and that state lives in an isolated SQLite
database — survive restarts, resume a conversation, or give every agent run its
own database or schema-only branch.

## Pattern

1. Wrap a PerSQL database in `PerSQLSaver` and pass it as the graph's
   checkpointer.
2. Invoke the graph with `{ configurable: { thread_id } }`. The same id resumes
   the stored state; a new id starts fresh.
3. Because the state is a regular PerSQL database, a fresh process — or a
   different machine — picks up exactly where the last one left off.

## Implementations

| Language | Framework | File |
|---|---|---|
| TypeScript | LangGraph.js (`@persql/langgraph`) | [typescript/](typescript/) |
| Python | LangGraph (`langgraph-checkpoint-persql`) | [python/](python/) |

## What you'll see

```
> My name is Ada and I work on compilers.
Nice to meet you, Ada!

  (exit, restart the script with the same THREAD_ID)

> What do I work on?
You work on compilers.   ← replayed from the checkpoint in PerSQL
```

The headless `ci.ts` / `ci.py` prove the same thing without an LLM: a real
graph's state accumulates across invocations, is recovered by a brand-new
checkpointer instance, and stays isolated per thread.
