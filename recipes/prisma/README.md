# Prisma

Point `PrismaClient` at an isolated PerSQL SQLite database through the
`@persql/prisma` driver adapter — one database per app, per tenant, or per agent,
provisioned instantly.

## Pattern

1. Model your data in `prisma/schema.prisma` with `provider = "sqlite"` and the
   `prisma-client` generator.
2. Generate the client (`prisma generate` — this recipe runs it on
   `npm install` via a `postinstall` hook).
3. Hand `PrismaClient` the PerSQL adapter:

```ts
import { PrismaClient } from "./generated/prisma/client";
import { PerSQL } from "@persql/sdk";
import { PrismaPerSQL } from "@persql/prisma";

const client = new PerSQL({ token: process.env.PERSQL_TOKEN });
const adapter = new PrismaPerSQL({ database: client.database("acme/app") });
const prisma = new PrismaClient({ adapter });

const widget = await prisma.widget.create({ data: { name: "sprocket", price: 4.5 } });
```

## Migrations

PerSQL's HTTP API has no held connection, so `prisma migrate dev` / `db push`
can't drive the database through the adapter. Apply schema changes with PerSQL's
migration tools, or generate the DDL with `prisma migrate diff` and apply it
once — then let `PrismaClient` handle every read and write. This recipe applies
its single-table schema directly (`schema.ts`); `prisma migrate dev` also needs
a shadow database, for which a schema-only PerSQL branch works well
(`shadowDatabase` on the adapter).

## Limits

- **Transactions are not atomic** — `prisma.$transaction(...)` runs its
  statements individually (the same trade-off as Prisma's Cloudflare D1
  adapter). For atomic multi-statement writes use `db.batch(stmts, { transaction: true })`
  from `@persql/sdk`.
- **`Bytes` columns are not supported** — store binary as base64 in a `String`.

The runnable code — Prisma schema, demo, and headless test — is in
[`typescript/`](typescript/).

## What you'll see

```
All widgets, cheapest first:
  #1 sprocket — $4.5
  #3 gizmo — $7.25 (out of stock)
  #2 gadget — $19
```

The headless `ci.ts` proves the same path without a token: `PrismaClient`
creates, queries, updates, and deletes rows through the adapter, and a fresh
client reads the persisted state.

## Run it

```sh
cd typescript
cp .env.example .env   # optional — unset runs against in-process SQLite
npm install            # also runs `prisma generate`
npm start              # demo
npx tsx ci.ts          # headless checks
```
