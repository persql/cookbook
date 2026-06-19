import "dotenv/config";
import assert from "node:assert/strict";
import { PerSQL, type PerSQLDatabase } from "@persql/sdk";
import { PrismaPerSQL } from "@persql/prisma";
import { PrismaClient } from "./generated/prisma/client.js";
import { SCHEMA_SQL } from "./schema.js";

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

const adapter = new PrismaPerSQL({ database: handle });
const prisma = new PrismaClient({ adapter });

try {
  await handle.query(SCHEMA_SQL);

  // 1. Create rows; the Boolean default and autoincrement id flow through.
  const created = await prisma.widget.create({ data: { name: "sprocket", price: 4.5 } });
  assert.ok(created.id > 0, "create did not return an id");
  assert.equal(created.inStock, true, "Boolean default did not apply");
  await prisma.widget.createMany({
    data: [
      { name: "gadget", price: 19.0 },
      { name: "gizmo", price: 7.25, inStock: false },
    ],
  });
  const all = await prisma.widget.findMany({ orderBy: { price: "asc" } });
  assert.deepEqual(
    all.map((w) => w.name),
    ["sprocket", "gizmo", "gadget"],
    `unexpected order: ${all.map((w) => w.name)}`
  );
  assert.equal(all[1].inStock, false, "Boolean column did not round-trip");
  console.log("[ci] create + ordered findMany ok");

  // 2. Filtered, projected query.
  const pricey = await prisma.widget.findMany({
    where: { inStock: true, price: { gt: 5 } },
    select: { name: true },
    orderBy: { name: "asc" },
  });
  assert.deepEqual(pricey.map((w) => w.name), ["gadget"], `filter wrong: ${JSON.stringify(pricey)}`);
  console.log("[ci] where + select ok");

  // 3. Update by unique id; confirm the exact affected-row count.
  await prisma.widget.update({ where: { id: created.id }, data: { price: 5.0 } });
  const sprocket = await prisma.widget.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(sprocket.price, 5.0, `update did not apply: ${sprocket.price}`);
  console.log("[ci] update ok");

  // 4. Delete, then confirm a fresh PrismaClient reads the persisted state.
  const removed = await prisma.widget.deleteMany({ where: { inStock: false } });
  assert.equal(removed.count, 1, `expected 1 deleted, got ${removed.count}`);
  const fresh = new PrismaClient({ adapter: new PrismaPerSQL({ database: handle }) });
  const remaining = await fresh.widget.count();
  await fresh.$disconnect();
  assert.equal(remaining, 2, `expected 2 after delete, got ${remaining}`);
  console.log("[ci] delete + reread by fresh client ok");

  console.log(`[ci] PASS (${mode})`);
} finally {
  await prisma.$disconnect();
  await cleanup?.();
}
