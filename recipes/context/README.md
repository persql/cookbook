# Shared Agent Context

Give a fleet of agents one shared, structured memory on a PerSQL database.
`@persql/context` turns a database handle into a store every agent surface —
SDK, MCP, published endpoints, CLI — can read and write, so facts a local agent
learns are there for a cloud agent next session.

Retrieval is **lexical**: FTS5 with BM25 ranking, no vector database. Layer one
over these rows if you need semantic similarity.

## Pattern

1. Wrap a PerSQL database with `context(persql.database("ns/db"), { source })`.
2. `await store.init()` once to create the schema (idempotent).
3. `remember` named facts, load the `index`, `recall` by keyword, relate
   entities with `link` / `neighbors`, `forget` what's stale.

```ts
import { PerSQL } from "@persql/sdk";
import { context } from "@persql/context";

const persql = new PerSQL({ token: process.env.PERSQL_TOKEN! });
const ctx = context(persql.database("acme/team-context"), { source: "my-agent" });
await ctx.init();

// Same name → update, not a duplicate.
await ctx.remember({
  name: "billing-model",
  description: "How customers pay",
  type: "project",
  body: "Usage drains a prepaid balance; top up via Checkout.",
});

const hits = await ctx.recall("how do customers pay"); // BM25-ranked
```

A memory is `name` + one-line `description` + `type`
(`user` | `feedback` | `project` | `reference`) + `body`. The **index** —
name + description, newest first — is cheap to load at the top of every session;
**recall** pulls the full bodies only when a keyword matches. `link(src, rel, dst)`
plus `neighbors(name)` answer "what touches X" that the flat memories can't.

It's the same two-table layout the
[`agent-memory`](../agent-memory) recipe builds by hand on the raw SDK — reach
for `@persql/context` when you want the FTS5 recall and entity graph without
writing the SQL.

Building on the OpenAI Agents SDK? `memoryTools(store)` returns
`remember_memory` / `recall_memory` / `forget_memory` tool definitions ready to
spread into `Agent({ tools })`, so the agent manages its own memory.

The runnable code — demo and headless test — is in [`typescript/`](typescript/).

## What you'll see

```
Memory index:
  [project] billing-model — How customers pay
  [user] reply-tone — Preferred voice for customer replies
  [reference] orders-schema — Shape of the orders table

Recall 'prepaid balance':
  billing-model: Prepaid balance with a one-time welcome credit ...

Graph around 'billing-meter':
  e_billing-meter --writes_to--> e_balance-ledger
  e_balance-ledger --stored_in--> e_control-d1
  (2 entities reachable)

Store now holds 2 memories, 3 entities, 2 edges.
```

The headless `ci.ts` proves the same path without a token: memories round-trip,
recall ranks the right hit first, a same-name write UPSERTs instead of
duplicating, an entity edge is walkable, and a fresh store reads the persisted
state.

## Run it

```sh
cd typescript
cp .env.example .env   # optional — unset runs against in-process SQLite
npm install
npm start              # demo
npx tsx ci.ts          # headless checks
```
