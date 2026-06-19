# Drizzle ORM

Use [Drizzle](https://orm.drizzle.team)'s typed query builder against an
isolated PerSQL SQLite database — one per app, per tenant, or per agent.

`@persql/drizzle` plugs into Drizzle's `sqlite-proxy` driver, so the query
builder, prepared statements, relations, and `drizzle-kit` migrations all work
unmodified against the PerSQL HTTP API.

## Pattern

1. Define your tables in `schema.ts` (or generate them from a live database with
   `npx persql-codegen`, shipped by `@persql/sdk`).
2. Wrap a PerSQL database with `drizzle(persql.database("ns/db"), { schema })`.
3. Query with the normal Drizzle API — `select`, `insert`, `update`, `delete`,
   `where`, joins, and so on.

```ts
import { drizzle } from "@persql/drizzle";
import { PerSQL } from "@persql/sdk";
import { eq } from "drizzle-orm";
import { widgets } from "./schema";

const persql = new PerSQL({ token: process.env.PERSQL_TOKEN! });
const db = drizzle(persql.database("acme/store"), { schema: { widgets } });

const inStock = await db.select().from(widgets).where(eq(widgets.inStock, true));
```

The `sqlite-proxy` driver runs one statement per round-trip and has no
interactive transactions — for an atomic multi-statement write, use
`db.batch(statements, { transaction: true })` from `@persql/sdk`.

## Implementations

| Language | Adapter | File |
|---|---|---|
| TypeScript | `@persql/drizzle` | [typescript/](typescript/) |

## What you'll see

```
All widgets, cheapest first:
  #1 sprocket — $4.5
  #3 gizmo — $7.25 (out of stock)
  #2 gadget — $19
```

The headless `ci.ts` proves the same path without a token: a real schema is
created, rows round-trip through the typed query builder (insert, filtered
select, update, delete), and a fresh client reads the persisted state.

## Run it

```sh
cd typescript
cp .env.example .env   # optional — unset runs against in-process SQLite
npm install
npm start              # demo
npx tsx ci.ts          # headless checks
```
