# Kysely

Write type-safe SQL with [Kysely](https://kysely.dev) against an isolated PerSQL
SQLite database. `@persql/kysely` is a Kysely dialect, so the query builder,
schema builder, and transactions all work unmodified.

## Pattern

1. Describe your tables with a Kysely `DB` interface (`schema.ts`).
2. Construct `new Kysely({ dialect: new PerSQLDialect({ database }) })`.
3. Query with the normal Kysely API.

```ts
import { Kysely } from "kysely";
import { PerSQLDialect } from "@persql/kysely";
import { PerSQL } from "@persql/sdk";
import type { DB } from "./schema";

const persql = new PerSQL({ token: process.env.PERSQL_TOKEN! });
const db = new Kysely<DB>({
  dialect: new PerSQLDialect({ database: persql.database("acme/store") }),
});

const rows = await db.selectFrom("widgets").selectAll().execute();
```

Statements between `BEGIN` and `COMMIT` are buffered and shipped as one
transactional batch, so `db.transaction()` is a single round-trip. Because the
batch result is discarded, **reads inside a transaction are not supported** —
run any `SELECT` / `RETURNING` outside the transaction (the dialect throws a
clear error if you don't).

## Implementations

| Language | Adapter | File |
|---|---|---|
| TypeScript | `@persql/kysely` | [typescript/](typescript/) |

## What you'll see

```
All widgets, cheapest first:
  #1 sprocket — $4.5
  #3 gizmo — $7.25 (out of stock)
  #2 gadget — $19
```

The headless `ci.ts` proves the same path without a token: rows round-trip
through the typed query builder, a `db.transaction()` of two writes commits
atomically in one batch, and a fresh connection reads the persisted state.

## Run it

```sh
cd typescript
cp .env.example .env   # optional — unset runs against in-process SQLite
npm install
npm start              # demo
npx tsx ci.ts          # headless checks
```
