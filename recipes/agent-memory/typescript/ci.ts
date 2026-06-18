import "dotenv/config";
import assert from "node:assert/strict";
import OpenAI from "openai";
import { Agent, run, setDefaultOpenAIClient } from "@openai/agents";
import { PerSQL } from "@persql/sdk";
import { MemoryStore, makeMemoryTools } from "./memory.js";

const persqlToken = process.env.PERSQL_TOKEN;
const persqlDatabase = process.env.PERSQL_DATABASE;
const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const cfApiToken = process.env.CLOUDFLARE_API_TOKEN;
const runId = process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`;

const mode = persqlToken ? "remote" : "local";
console.log(`[ci] mode=${mode}`);

// Remote: claim a fresh branch per run for isolation, delete it on exit.
// Local:  in-process :memory: SQLite, no network, no cost.
let persql: PerSQL;
let store: MemoryStore;
let cleanup: (() => Promise<void>) | undefined;

if (persqlToken && persqlDatabase) {
  const parent = new PerSQL({ token: persqlToken });
  const branchRef = `ci-${runId}`;
  const claimed = await parent.database(persqlDatabase).branches.claim({
    ref: branchRef,
    role: "admin",
    ttlSec: 3600,
  });
  persql = new PerSQL({ token: claimed.token });
  store = new MemoryStore(
    persql.database(`${claimed.namespaceSlug}/${claimed.databaseSlug}`)
  );
  cleanup = async () => {
    await parent.database(persqlDatabase).branches.delete(branchRef);
    console.log("[ci] branch cleaned up");
  };
} else {
  persql = new PerSQL({ local: ":memory:" });
  store = new MemoryStore(persql.database("test/ci"));
}

try {
  await store.init();

  // 1. Save a known memory.
  await store.remember({
    name: "ci-test-fact",
    description: "Widget table schema for CI",
    type: "project",
    body: "The widgets table has: id INTEGER PRIMARY KEY, name TEXT, price REAL.",
  });
  console.log("[ci] memory saved");

  // 2. Round-trip via recall.
  const hits = await store.recall("widgets price");
  assert.ok(hits.length > 0, "recall returned no results");
  assert.ok(hits[0].body.includes("price REAL"), `unexpected body: ${hits[0].body}`);
  console.log("[ci] recall ok");

  // 3. Agent turn — answer from injected memory, no recall tool call.
  if (!cfAccountId || !cfApiToken) {
    console.log("[ci] CF env vars not set — skipping agent turn");
  } else {
    // Cast needed: @openai/agents bundles its own nested openai sub-dep.
    setDefaultOpenAIClient(
      new OpenAI({
        apiKey: cfApiToken,
        baseURL: `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/ai/v1`,
      }) as unknown as Parameters<typeof setDefaultOpenAIClient>[0]
    );

    const memories = await store.index();
    const memSection = memories
      .map((m) => `[${m.type}] ${m.name}\n${m.description}\n---\n${m.body}`)
      .join("\n\n");

    const agent = new Agent({
      name: "ci-agent",
      model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      instructions: `You are a helpful assistant.\n\nMEMORIES:\n${memSection}\n\nAnswer questions covered above directly without calling any tool first.`,
      tools: makeMemoryTools(store),
    });

    const result = await run(agent, "What columns does the widgets table have?");
    assert.ok(result.finalOutput, "agent returned empty output");
    assert.ok(
      result.finalOutput.toLowerCase().includes("price"),
      `response did not mention price: ${result.finalOutput}`
    );
    console.log(`[ci] agent turn ok — "${result.finalOutput.slice(0, 80)}..."`);
  }

  // 4. Forget and confirm gone.
  await store.forget("ci-test-fact");
  const after = await store.recall("widgets price");
  assert.ok(after.length === 0, "memory still returned after forget");
  console.log("[ci] forget ok");

  console.log(`[ci] PASS (${mode})`);
} finally {
  await cleanup?.();
}
