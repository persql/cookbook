import "dotenv/config";
import assert from "node:assert/strict";
import type { AgentInputItem } from "@openai/agents";
import { PerSQL, type PerSQLDatabase } from "@persql/sdk";
import { PerSQLSession } from "@persql/openai-agents";

const token = process.env.PERSQL_TOKEN;
const database = process.env.PERSQL_DATABASE;
const runId = process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`;

const mode = token ? "remote" : "local";
console.log(`[ci] mode=${mode}`);

// Remote: claim a fresh branch per run for isolation, delete it on exit.
// Local:  in-process :memory: SQLite, no network, no cost.
let db: PerSQLDatabase;
let cleanup: (() => Promise<void>) | undefined;

if (token && database) {
  const parent = new PerSQL({ token });
  const branchRef = process.env.PERSQL_BRANCH_REF ?? `ci-${runId}`;
  const claimed = await parent.database(database).branches.claim({
    ref: branchRef,
    role: "admin",
    ttlSec: 3600,
  });
  db = new PerSQL({ token: claimed.token }).database(
    `${claimed.namespaceSlug}/${claimed.databaseSlug}`
  );
  cleanup = async () => {
    await parent.database(database).branches.delete(branchRef);
    console.log("[ci] branch cleaned up");
  };
} else {
  db = new PerSQL({ local: ":memory:" }).database("test/ci");
}

const msg = (role: "user" | "assistant", content: string): AgentInputItem =>
  ({ role, content }) as AgentInputItem;

try {
  // 1. Append a turn the way Runner does, then read it back in order.
  const session = new PerSQLSession("user-1", db);
  await session.addItems([msg("user", "I prefer metric units."), msg("assistant", "Got it.")]);
  const items = await session.getItems();
  assert.equal(items.length, 2, `expected 2 items, got ${items.length}`);
  assert.equal((items[0] as { content: string }).content, "I prefer metric units.");
  console.log("[ci] history round-trips");

  // 2. A fresh session over the same database and id replays the stored
  //    history — survives a process restart, not just an in-memory cache.
  const resumed = new PerSQLSession("user-1", db);
  const replayed = await resumed.getItems();
  assert.equal(replayed.length, 2, `restart lost history: ${replayed.length}`);
  console.log("[ci] history recovered by a fresh session");

  // 3. Sessions are isolated — a different id sees nothing.
  const other = new PerSQLSession("user-2", db);
  assert.equal((await other.getItems()).length, 0, "session isolation broken");
  console.log("[ci] sessions isolated");

  // 4. clearSession wipes one session's history.
  await resumed.clearSession();
  assert.equal((await resumed.getItems()).length, 0, "clearSession left items");
  console.log("[ci] clearSession ok");

  console.log(`[ci] PASS (${mode})`);
} finally {
  await cleanup?.();
}
