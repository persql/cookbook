import "dotenv/config";
import { context } from "@persql/context";
import { PerSQL, type PerSQLDatabase } from "@persql/sdk";

// One shared store, readable and writable from every agent surface. Set
// PERSQL_TOKEN + PERSQL_DATABASE to point a whole fleet at the same memory;
// unset, this runs against in-process SQLite so you can try it with no account.
const token = process.env.PERSQL_TOKEN;
const database = process.env.PERSQL_DATABASE;

const handle: PerSQLDatabase =
  token && database
    ? new PerSQL({ token }).database(database)
    : new PerSQL({ local: ":memory:" }).database("acme/team-context");

const ctx = context(handle, { source: "onboarding-agent" });
await ctx.init(); // create the schema once (idempotent)

// 1. Remember structured facts. Each is a named memory with a one-line
//    description (always loaded into the agent's index) and a fuller body.
await ctx.remember({
  name: "billing-model",
  description: "How customers pay",
  type: "project",
  body: "Usage is metered into a prepaid balance. No subscription; customers top up via Checkout.",
});
await ctx.remember({
  name: "reply-tone",
  description: "Preferred voice for customer replies",
  type: "user",
  body: "Keep replies short and declarative. No exclamation marks.",
});
await ctx.remember({
  name: "orders-schema",
  description: "Shape of the orders table",
  type: "reference",
  body: "orders(id, customer_id, total_cents, status). status is one of new|paid|shipped.",
});

// 2. The index is the always-loadable table of contents — name + description,
//    newest first. An agent loads this at the start of every session.
console.log("Memory index:");
for (const m of await ctx.index()) {
  console.log(`  [${m.type}] ${m.name} — ${m.description}`);
}

// 3. Same name → update, not a duplicate. The store UPSERTs by name.
await ctx.remember({
  name: "billing-model",
  description: "How customers pay",
  type: "project",
  body: "Prepaid balance with a one-time welcome credit on the first runs; top up via Checkout.",
});

// 4. Recall is lexical (FTS5, BM25-ranked) — no vector database. Search the
//    bodies for the most relevant memory.
console.log("\nRecall 'prepaid balance':");
for (const m of await ctx.recall("prepaid balance")) {
  console.log(`  ${m.name}: ${m.body}`);
}

// 5. Relate entities into a small graph, then walk the neighbourhood — answers
//    "what touches X" that the flat memories can't.
await ctx.link("billing-meter", "writes_to", "balance-ledger");
await ctx.link("balance-ledger", "stored_in", "control-d1");
const { entities, edges } = await ctx.neighbors("billing-meter", { depth: 2 });
console.log("\nGraph around 'billing-meter':");
for (const e of edges) console.log(`  ${e.src} --${e.rel}--> ${e.dst}`);
console.log(`  (${entities.length} entities reachable)`);

// 6. Forget what's no longer true.
await ctx.forget("orders-schema");

const stats = await ctx.stats();
console.log(
  `\nStore now holds ${stats.memories} memories, ${stats.entities} entities, ${stats.edges} edges.`
);
