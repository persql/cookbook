import "dotenv/config";
import assert from "node:assert/strict";
import { drizzle } from "@persql/drizzle";
import { PerSQL, type PerSQLDatabase } from "@persql/sdk";
import { asc, eq, gt, sql } from "drizzle-orm";
import { widgets } from "./schema.js";

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

try {
  const db = drizzle(handle, { schema: { widgets } });

  await db.run(sql`
    CREATE TABLE widgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      in_stock INTEGER NOT NULL DEFAULT 1
    )
  `);

  // 1. Insert through the typed query builder.
  await db.insert(widgets).values([
    { name: "sprocket", price: 4.5 },
    { name: "gadget", price: 19.0 },
    { name: "gizmo", price: 7.25, inStock: false },
  ]);
  const all = await db.select().from(widgets).orderBy(asc(widgets.price));
  assert.equal(all.length, 3, `expected 3 rows, got ${all.length}`);
  assert.deepEqual(
    all.map((w) => w.name),
    ["sprocket", "gizmo", "gadget"],
    `unexpected order: ${all.map((w) => w.name)}`
  );
  assert.equal(all[1].inStock, false, "boolean column did not round-trip");
  console.log("[ci] insert + ordered select ok");

  // 2. Filtered, projected select.
  const pricey = await db
    .select({ name: widgets.name })
    .from(widgets)
    .where(gt(widgets.price, 5))
    .orderBy(asc(widgets.name));
  assert.deepEqual(pricey.map((w) => w.name), ["gadget", "gizmo"], `filter wrong: ${pricey}`);
  console.log("[ci] where + projection ok");

  // 3. Update one row, confirm the new value.
  await db.update(widgets).set({ price: 5.0 }).where(eq(widgets.name, "sprocket"));
  const [sprocket] = await db
    .select()
    .from(widgets)
    .where(eq(widgets.name, "sprocket"));
  assert.equal(sprocket.price, 5.0, `update did not apply: ${sprocket.price}`);
  console.log("[ci] update ok");

  // 4. Delete, then confirm a fresh client reads the persisted state — the
  //    data lives in the database, not the wrapper.
  await db.delete(widgets).where(eq(widgets.inStock, false));
  const fresh = drizzle(handle, { schema: { widgets } });
  const [{ n }] = await fresh
    .select({ n: sql<number>`count(*)` })
    .from(widgets);
  assert.equal(Number(n), 2, `expected 2 after delete, got ${n}`);
  console.log("[ci] delete + reread by fresh client ok");

  console.log(`[ci] PASS (${mode})`);
} finally {
  await cleanup?.();
}
