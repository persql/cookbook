import "dotenv/config";
import assert from "node:assert/strict";
import { Kysely } from "kysely";
import { PerSQLDialect } from "@persql/kysely";
import { PerSQL, type PerSQLDatabase } from "@persql/sdk";
import type { DB } from "./schema.js";

const token = process.env.PERSQL_TOKEN;
const database = process.env.PERSQL_DATABASE;
const runId = process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`;

const mode = token ? "remote" : "local";
console.log(`[ci] mode=${mode}`);

// Remote: claim a fresh branch per run for isolation, delete it on exit.
// Local:  in-process :memory: SQLite, no network, no cost.
let handle: PerSQLDatabase;
let cleanup: (() => Promise<void>) | undefined;

if (token && database) {
  const parent = new PerSQL({ token });
  const branchRef = process.env.PERSQL_BRANCH_REF ?? `ci-${runId}`;
  const claimed = await parent.database(database).branches.claim({
    ref: branchRef,
    role: "admin",
    ttlSec: 3600,
  });
  handle = new PerSQL({ token: claimed.token }).database(
    `${claimed.namespaceSlug}/${claimed.databaseSlug}`
  );
  cleanup = async () => {
    await parent.database(database).branches.delete(branchRef);
    console.log("[ci] branch cleaned up");
  };
} else {
  handle = new PerSQL({ local: ":memory:" }).database("test/ci");
}

const db = new Kysely<DB>({ dialect: new PerSQLDialect({ database: handle }) });

try {
  await db.schema
    .createTable("widgets")
    .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("price", "real", (c) => c.notNull())
    .addColumn("in_stock", "integer", (c) => c.notNull().defaultTo(1))
    .execute();

  // 1. Insert through the typed query builder.
  await db
    .insertInto("widgets")
    .values([
      { name: "sprocket", price: 4.5, in_stock: 1 },
      { name: "gadget", price: 19.0, in_stock: 1 },
      { name: "gizmo", price: 7.25, in_stock: 0 },
    ])
    .execute();
  const all = await db.selectFrom("widgets").selectAll().orderBy("price", "asc").execute();
  assert.equal(all.length, 3, `expected 3 rows, got ${all.length}`);
  assert.deepEqual(
    all.map((w) => w.name),
    ["sprocket", "gizmo", "gadget"],
    `unexpected order: ${all.map((w) => w.name)}`
  );
  console.log("[ci] insert + ordered select ok");

  // 2. Filtered, projected select.
  const pricey = await db
    .selectFrom("widgets")
    .select("name")
    .where("price", ">", 5)
    .orderBy("name", "asc")
    .execute();
  assert.deepEqual(pricey.map((w) => w.name), ["gadget", "gizmo"], `filter wrong: ${pricey}`);
  console.log("[ci] where + projection ok");

  // 3. A transaction buffers its writes and ships them as one atomic batch.
  await db.transaction().execute(async (trx) => {
    await trx.insertInto("widgets").values({ name: "cog", price: 2.0, in_stock: 1 }).execute();
    await trx.updateTable("widgets").set({ price: 5.0 }).where("name", "=", "sprocket").execute();
  });
  const cog = await db.selectFrom("widgets").selectAll().where("name", "=", "cog").executeTakeFirst();
  const sprocket = await db
    .selectFrom("widgets")
    .select("price")
    .where("name", "=", "sprocket")
    .executeTakeFirstOrThrow();
  assert.ok(cog, "transaction insert did not commit");
  assert.equal(sprocket.price, 5.0, `transaction update did not commit: ${sprocket.price}`);
  console.log("[ci] atomic transaction ok");

  // 4. Delete, then confirm a fresh connection reads the persisted state.
  await db.deleteFrom("widgets").where("in_stock", "=", 0).execute();
  const fresh = new Kysely<DB>({ dialect: new PerSQLDialect({ database: handle }) });
  const [{ n }] = await fresh
    .selectFrom("widgets")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .execute();
  assert.equal(Number(n), 3, `expected 3 after delete, got ${n}`);
  await fresh.destroy();
  console.log("[ci] delete + reread by fresh connection ok");

  console.log(`[ci] PASS (${mode})`);
} finally {
  await db.destroy();
  await cleanup?.();
}
