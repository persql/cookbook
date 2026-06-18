/**
 * Headless integration test for the agent-memory recipe.
 *
 * Local mode  (default, no secrets): PerSQL({ local: ":memory:" })
 *   — proves the SDK and @persql/context API contract. No LLM call.
 *
 * Remote mode (PERSQL_TOKEN + CF env vars set): hits real PerSQL + CF Workers AI.
 *   — proves end-to-end: SDK → /v1 → Durable Object + LLM turn.
 *
 * Exit 0 on pass, 1 on failure. No interactive input.
 */

import "dotenv/config";
import assert from "node:assert/strict";
import OpenAI from "openai";
import { Agent, run, setDefaultOpenAIClient } from "@openai/agents";
import { PerSQL } from "@persql/sdk";
import { context, memoryTools } from "@persql/context";

const persqlToken = process.env.PERSQL_TOKEN;
const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const cfApiToken = process.env.CLOUDFLARE_API_TOKEN;
const database = process.env.PERSQL_DATABASE ?? "ci/agent-memory";

const mode = persqlToken ? "remote" : "local";
console.log(`[ci] mode=${mode}`);

// Local mode when no token — no network, no cost.
const persql = persqlToken
  ? new PerSQL({ token: persqlToken })
  : new PerSQL({ local: ":memory:" });

const store = context(persql.database(database), { source: "ci" });
await store.init();

// 1. Save a known memory.
await store.remember({
  name: "ci-test-fact",
  description: "Widget table schema for CI",
  type: "project",
  body: "The widgets table has: id INTEGER PRIMARY KEY, name TEXT, price REAL.",
});
console.log("[ci] memory saved");

// 2. Verify it round-trips through recall.
const hits = await store.recall("widgets price");
assert.ok(hits.length > 0, "recall returned no results");
assert.ok(hits[0].body.includes("price REAL"), `unexpected body: ${hits[0].body}`);
console.log("[ci] recall ok");

// 3. Run one agent turn — should answer from injected memory without a recall tool call.
if (!cfAccountId || !cfApiToken) {
  console.log("[ci] CF env vars not set — skipping agent turn");
} else {
  setDefaultOpenAIClient(
    new OpenAI({
      apiKey: cfApiToken,
      baseURL: `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/ai/v1`,
    })
  );

  const memories = await store.index();
  const memSection = memories
    .map((m) => `[${m.type}] ${m.name}\n${m.description}\n---\n${m.body}`)
    .join("\n\n");

  let recallCalled = false;
  const wrappedTools = memoryTools(store).map((t) => ({
    ...t,
    invoke: async (input: Record<string, unknown>) => {
      if (t.name === "recall_memory") recallCalled = true;
      return t.invoke(input);
    },
  }));

  const agent = new Agent({
    name: "ci-agent",
    model: "@cf/meta/llama-3.3-70b-instruct",
    instructions: `You are a helpful assistant.\n\nMEMORIES:\n${memSection}\n\nAnswer questions covered above directly without calling any tool first.`,
    tools: wrappedTools,
  });

  const result = await run(agent, "What columns does the widgets table have?");
  assert.ok(result.finalOutput, "agent returned empty output");
  assert.ok(
    result.finalOutput.toLowerCase().includes("price"),
    `response did not mention price: ${result.finalOutput}`
  );
  assert.ok(!recallCalled, "agent called recall_memory instead of answering from injected memory");
  console.log(`[ci] agent turn ok — "${result.finalOutput.slice(0, 80)}..."`);
}

// 4. Forget and confirm gone.
await store.forget("ci-test-fact");
const after = await store.recall("widgets price");
assert.ok(after.length === 0, "memory still returned after forget");
console.log("[ci] forget ok");

console.log(`[ci] PASS (${mode})`);
