# Agent Framework History

Persist Microsoft Agent Framework conversation history across process restarts
using PerSQL as the history provider.

The Agent Framework loads and stores messages through a `HistoryProvider`. Back
it with `PerSQLHistoryProvider` and each session's messages live in an isolated
SQLite database — durable, queryable, and reachable from anywhere.

## Pattern

1. Construct `PerSQLHistoryProvider(db)` over a PerSQL database and pass it as a
   context provider to the agent.
2. Run the agent with a `session_id`. The provider stores the turn and replays
   prior messages on the next run.
3. Re-running with the same session id resumes the conversation; a new id starts
   fresh. A `None` session id maps to one shared `"default"` history.

## Implementations

| Language | Framework | File |
|---|---|---|
| Python | Microsoft Agent Framework (`agent-framework-persql`) | [python/](python/) |

## What you'll see

```
> My name is Priya.
Hello, Priya!

  (exit, restart the script with the same SESSION_ID)

> What's my name?
Priya.   ← replayed from the message history in PerSQL
```

The headless `ci.py` proves the same thing without an LLM: saved messages
round-trip in order, are recovered by a brand-new provider instance, stay
isolated per session, and clear on demand.
