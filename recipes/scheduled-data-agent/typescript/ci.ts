import "dotenv/config";
import assert from "node:assert/strict";
import { PerSQL } from "@persql/sdk";

const persqlToken = process.env.PERSQL_TOKEN;
const persqlDatabase = process.env.PERSQL_DATABASE;
const runId = process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`;

// Data agents are a remote-only surface — `db.agents.*` throws in local mode
// because the loop runs on the database's Durable Object. With no token we
// type-check and exit clean (the build still proves the API contract compiles).
if (!persqlToken || !persqlDatabase) {
  console.log("[ci] mode=local — db.agents requires a remote database, skipping");
  console.log("[ci] PASS (local)");
  process.exit(0);
}

console.log("[ci] mode=remote");

// Claim a fresh branch per run for isolation; admin role so we can manage
// agents. Delete it on exit.
const parent = new PerSQL({ token: persqlToken });
const branchRef = process.env.PERSQL_BRANCH_REF ?? `ci-${runId}`;
const claimed = await parent.database(persqlDatabase).branches.claim({
  ref: branchRef,
  role: "admin",
  ttlSec: 3600,
});
const persql = new PerSQL({ token: claimed.token });
const db = persql.database(`${claimed.namespaceSlug}/${claimed.databaseSlug}`);

try {
  // Seed a tiny table for the agent to inspect.
  await db.query(
    "CREATE TABLE IF NOT EXISTS widgets (id INTEGER PRIMARY KEY, name TEXT, price REAL)"
  );
  await db.query(
    "INSERT INTO widgets (name, price) VALUES ('bolt', 0.5), ('gear', 3.25), ('spring', 1.1)"
  );

  // 1. Create — config round-trips, write-only headers never echo.
  const created = await db.agents.create({
    name: "ci-widget-reporter",
    goal: "Report how many widgets exist and the total of their prices. Do not modify any data.",
    intervalSec: 3600,
    approvalMode: "writes",
    maxIters: 3,
  });
  assert.equal(created.name, "ci-widget-reporter", "name did not round-trip");
  assert.equal(created.approvalMode, "writes", "approvalMode did not round-trip");
  assert.equal(created.intervalSec, 3600, "intervalSec did not round-trip");
  assert.equal(created.enabled, true, "agent should start enabled");
  assert.equal(created.runsCount, 0, "fresh agent should have 0 runs");
  console.log(`[ci] create ok — ${created.id.slice(0, 8)}`);

  // 2. Run one cycle. Assert the mechanism advanced — runsCount ticks and a
  // last-run timestamp lands. The model is non-deterministic, so we log the
  // status and summary rather than asserting on the model's prose.
  const ran = await db.agents.run(created.id);
  assert.ok(ran.runsCount >= 1, "run did not increment runsCount");
  assert.ok(ran.lastRunAt, "run did not record lastRunAt");
  assert.notEqual(ran.lastStatus, null, "run did not record a status");
  console.log(
    `[ci] run ok — status=${ran.lastStatus} rounds=${ran.lastRounds ?? 0} ` +
      `read=${ran.lastRowsRead ?? 0} summary="${(ran.lastSummary ?? "").slice(0, 60)}"`
  );

  // 3. Update — patch a field and confirm it reflects.
  const updated = await db.agents.update(created.id, { intervalSec: 1800 });
  assert.equal(updated.intervalSec, 1800, "update did not change intervalSec");
  console.log("[ci] update ok");

  // 4. List — the agent is present.
  const { data: listed } = await db.agents.list();
  assert.ok(
    listed.some((a) => a.id === created.id),
    "created agent missing from list"
  );
  console.log(`[ci] list ok — ${listed.length} agent(s)`);

  // 5. Delete — and confirm it's gone.
  const del = await db.agents.delete(created.id);
  assert.equal(del.deleted, true, "delete did not report success");
  const { data: after } = await db.agents.list();
  assert.ok(
    !after.some((a) => a.id === created.id),
    "agent still present after delete"
  );
  console.log("[ci] delete ok");

  console.log("[ci] PASS (remote)");
} finally {
  await parent.database(persqlDatabase).branches.delete(branchRef);
  console.log("[ci] branch cleaned up");
}
