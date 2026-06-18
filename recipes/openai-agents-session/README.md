# OpenAI Agents Session

Persist OpenAI Agents SDK conversation history across process restarts using
PerSQL as the session backend.

The Agents SDK reads and writes turn history through a `Session`. Back it with
`PerSQLSession` and every run appends the turn's input and output to an isolated
SQLite database; the next run replays the stored history to the model
automatically — so the agent remembers across restarts, and each user (or
thread, or tenant) gets their own database.

## Pattern

1. Construct `PerSQLSession(sessionId, db)` over a PerSQL database.
2. Pass it to `run(agent, input, { session })` (TS) / `Runner.run(agent, input,
   session=session)` (Python). The SDK handles append + replay.
3. Re-running with the same session id resumes the conversation; a new id
   starts a fresh one.

## Implementations

| Language | Framework | File |
|---|---|---|
| TypeScript | OpenAI Agents SDK (`@persql/openai-agents`) | [typescript/](typescript/) |
| Python | OpenAI Agents SDK (`openai-agents-persql`) | [python/](python/) |

## What you'll see

```
> My favorite language is Rust.
Noted!

  (exit, restart the script with the same SESSION_ID)

> What's my favorite language?
Rust.   ← replayed from the session history in PerSQL
```

The headless `ci.ts` / `ci.py` prove the same thing without an LLM: appended
turns round-trip, are recovered by a brand-new session instance, stay isolated
per session id, and clear on demand.
