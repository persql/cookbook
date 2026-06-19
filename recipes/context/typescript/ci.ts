import "dotenv/config";
import assert from "node:assert/strict";
import { context, entityId } from "@persql/context";
import { PerSQL, type PerSQLDatabase } from "@persql/sdk";

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
  const ctx = context(handle, { source: "ci-agent" });
  await ctx.init();

  // 1. Remember three memories, confirm they land in the always-loaded index.
  await ctx.remember({
    name: "billing-model",
    description: "How customers pay",
    type: "project",
    body: "Usage is metered into a prepaid balance, topped up via Checkout.",
  });
  await ctx.remember({
    name: "reply-tone",
    description: "Voice for replies",
    type: "user",
    body: "Short, declarative, no exclamation marks.",
  });
  await ctx.remember({
    name: "orders-schema",
    description: "Orders table shape",
    type: "reference",
    body: "orders(id, customer_id, total_cents, status).",
  });
  const index = await ctx.index();
  assert.equal(index.length, 3, `expected 3 memories, got ${index.length}`);
  assert.deepEqual(
    [...index.map((m) => m.name)].sort(),
    ["billing-model", "orders-schema", "reply-tone"],
    `unexpected index: ${index.map((m) => m.name)}`
  );
  console.log("[ci] remember + index ok");

  // 2. Lexical recall (FTS5/BM25) surfaces the most relevant memory first.
  const hits = await ctx.recall("prepaid balance checkout");
  assert.ok(hits.length >= 1, "recall returned nothing");
  assert.equal(hits[0].name, "billing-model", `wrong top hit: ${hits[0]?.name}`);
  console.log("[ci] recall ok");

  // 3. Same name UPSERTs — the body changes, the row count does not.
  await ctx.remember({
    name: "billing-model",
    description: "How customers pay",
    type: "project",
    body: "Prepaid balance with a one-time welcome credit on first use.",
  });
  const afterUpsert = await ctx.index();
  assert.equal(afterUpsert.length, 3, "upsert created a duplicate row");
  const updated = await ctx.get("billing-model");
  assert.ok(updated?.body.includes("welcome credit"), "upsert did not change body");
  console.log("[ci] upsert by name ok");

  // 4. Entity graph: link two entities, walk the neighbourhood. Edges store
  //    entity ids (entityId(name)), not the raw names.
  await ctx.link("billing-meter", "writes_to", "balance-ledger");
  const { edges } = await ctx.neighbors("billing-meter", { depth: 1 });
  assert.ok(
    edges.some(
      (e) =>
        e.src === entityId("billing-meter") &&
        e.dst === entityId("balance-ledger") &&
        e.rel === "writes_to"
    ),
    "linked edge not found in neighbourhood"
  );
  console.log("[ci] link + neighbors ok");

  // 5. Forget removes the memory by name.
  await ctx.forget("orders-schema");
  assert.equal(await ctx.get("orders-schema"), null, "forget did not delete");

  // 6. A fresh store reads the persisted state — memory lives in the database,
  //    not the wrapper. Two memories survive, one edge, two entities.
  const fresh = context(handle);
  const stats = await fresh.stats();
  assert.equal(stats.memories, 2, `expected 2 memories, got ${stats.memories}`);
  assert.equal(stats.edges, 1, `expected 1 edge, got ${stats.edges}`);
  assert.equal(stats.entities, 2, `expected 2 entities, got ${stats.entities}`);
  console.log("[ci] forget + reread by fresh store ok");

  console.log(`[ci] PASS (${mode})`);
} finally {
  await cleanup?.();
}
