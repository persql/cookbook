# Google ADK Session

Persist Google ADK sessions, events, and state across process restarts using
PerSQL as the session service.

ADK reads and writes conversation state through a `SessionService`. Back it with
`PerSQLSessionService` and sessions, events, and the `app:` / `user:` /
session-scoped state all live in an isolated SQLite database — the same
four-table layout and scope semantics as ADK's built-in `SqliteSessionService`,
but provisioned instantly and reachable from anywhere.

## Pattern

1. Construct `PerSQLSessionService(db)` over a PerSQL database and pass it to the
   ADK `Runner`.
2. Create a session id once; reuse it across restarts to resume the stored
   events and merged state.
3. `app:`-prefixed state is shared across users, `user:`-prefixed across that
   user's sessions, plain keys stay session-scoped, and `temp:` keys are never
   persisted.

## Implementations

| Language | Framework | File |
|---|---|---|
| Python | Google ADK (`google-adk-persql`) | [python/](python/) |

## What you'll see

```
> Remember that our launch date is March 3rd.
Noted — launch date is March 3rd.

  (exit, restart the script with the same SESSION_ID)

> When do we launch?
March 3rd.   ← replayed from the session events in PerSQL
```

The headless `ci.py` proves the same thing without an LLM: a session's events
and state delta persist, are recovered by a brand-new service instance, stay
isolated per user, and delete cleanly.
