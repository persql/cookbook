# Strands Session

Persist AWS Strands agent sessions, state, and messages across process restarts
using PerSQL as the session store.

Strands persists agent state through a `SessionManager` / `SessionRepository`.
Back it with PerSQL and one row per session, agent, and message lives in an
isolated SQLite database — the same data model as Strands' `FileSessionManager`,
with tables instead of directories, provisioned instantly.

## Pattern

1. Construct `PerSQLSessionManager(sessionId, db)` over a PerSQL database and
   pass it to the `Agent`.
2. The agent reads and writes its messages and state through the manager on
   every turn.
3. Re-running with the same session id resumes the conversation and state; a new
   id starts fresh.

`PerSQLSessionRepository` is also exported for use with `RepositorySessionManager`
or your own manager.

## Implementations

| Language | Framework | File |
|---|---|---|
| Python | AWS Strands Agents (`strands-persql`) | [python/](python/) |

## What you'll see

```
> Remember that I'm allergic to peanuts.
Got it — I'll keep that in mind.

  (exit, restart the script with the same SESSION_ID)

> What am I allergic to?
Peanuts.   ← replayed from the session messages in PerSQL
```

The headless `ci.py` proves the same thing without an LLM: a session, its agent,
and its messages persist, are recovered by a brand-new repository instance, stay
isolated per id, and delete cleanly.
