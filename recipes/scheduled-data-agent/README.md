# Scheduled Data Agent

Give a database a standing goal and a cadence; PerSQL runs the LLM loop for you.

A [data agent](https://docs.persql.com/platform/data-agents/) is a scheduled agent welded to one database. You hand it a natural-language goal ("keep the rollup fresh", "triage new rows") and an interval; it wakes on that cadence, inspects the data, calls tools, optionally fetches the web, and writes rows back — with optional human approval on its writes.

## Pattern

1. Create an agent with `db.agents.create({ name, goal, intervalSec, approvalMode })` using an admin-role token.
2. The platform schedules it on the database's own instance — no cron of yours to run.
3. Trigger a cycle on demand with `db.agents.run(id)`; inspect `lastStatus` / `lastSummary` / `lastRowsWritten`.
4. `approvalMode` decides which of the agent's writes pause for a human (`auto` / `destructive` / `writes`).

## Implementations

| Language | SDK | File |
|---|---|---|
| TypeScript | `@persql/sdk` | [typescript/](typescript/) |

> Data agents are a remote-only surface — `db.agents.*` runs the loop on the database's Durable Object, so there is no local (`:memory:`) mode. The TypeScript `ci.ts` type-checks always and exercises the full lifecycle against a fresh branch when `PERSQL_TOKEN` is set.

## What you'll see

```
Creating a data agent…
  → widget-reporter (f4078798), every 1h
Running one cycle now…
  status: ok
  summary: The widgets table contains 4 widgets with a total price of 5.05. No changes were made.
  rounds=2 read=4 written=0
Agents on myteam/metrics: widget-reporter
Deleted the demo agent.
```

## Run it

```sh
cd typescript
cp .env.example .env   # add PERSQL_TOKEN (admin) and PERSQL_DATABASE
npm install
npm start
```
