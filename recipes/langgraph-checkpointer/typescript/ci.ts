import "dotenv/config";
import assert from "node:assert/strict";
import { PerSQL, type PerSQLDatabase } from "@persql/sdk";
import { PerSQLSaver } from "@persql/langgraph";
import { buildCounterGraph } from "./graph.js";

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

try {
  const thread = { configurable: { thread_id: "t1" } };

  // 1. A real LangGraph graph runs through the saver; state must accumulate
  //    across separate invocations on the same thread.
  const graph = buildCounterGraph(new PerSQLSaver(db));
  const first = await graph.invoke({ total: 0 }, thread);
  assert.equal(first.total, 1, `expected 1, got ${first.total}`);
  const second = await graph.invoke({ total: 0 }, thread);
  assert.equal(second.total, 2, `expected 2, got ${second.total}`);
  console.log("[ci] state persisted across invocations");

  // 2. A fresh checkpointer over the same database resumes the stored state —
  //    i.e. it survives a process restart, not just an in-memory cache.
  const resumed = buildCounterGraph(new PerSQLSaver(db));
  const snapshot = await resumed.getState(thread);
  assert.equal(snapshot.values.total, 2, `restart lost state: ${snapshot.values.total}`);
  console.log("[ci] state recovered by a fresh checkpointer");

  // 3. Threads are isolated — a new thread starts from zero.
  const other = await graph.invoke({ total: 0 }, { configurable: { thread_id: "t2" } });
  assert.equal(other.total, 1, `thread isolation broken: ${other.total}`);
  console.log("[ci] threads isolated");

  console.log(`[ci] PASS (${mode})`);
} finally {
  await cleanup?.();
}
