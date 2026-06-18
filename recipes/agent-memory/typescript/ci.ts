import "dotenv/config";
import assert from "node:assert/strict";
import OpenAI from "openai";
import {
  Agent,
  run,
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled,
} from "@openai/agents";
import { PerSQL } from "@persql/sdk";
import { MemoryStore, makeMemoryTools } from "./memory.js";

const persqlToken = process.env.PERSQL_TOKEN;
const persqlDatabase = process.env.PERSQL_DATABASE;
const openaiKey = process.env.OPENAI_API_KEY;
// Optional OpenAI-compatible gateway. Unset → the SDK's default OpenAI API.
const openaiBaseUrl = process.env.OPENAI_BASE_URL;
const openaiModel = process.env.OPENAI_MODEL || "gpt-4o-mini";
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
  // @openai/agents reads OPENAI_API_KEY from the environment automatically.
  if (!openaiKey) {
    console.log("[ci] OPENAI_API_KEY not set — skipping agent turn");
  } else {
    if (openaiBaseUrl) {
      // Custom gateway: cast needed (@openai/agents bundles a nested openai
      // sub-dep). Gateways speak /chat/completions, not /responses, and have
      // no platform.openai.com tracing.
      setDefaultOpenAIClient(
        new OpenAI({ apiKey: openaiKey, baseURL: openaiBaseUrl }) as unknown as Parameters<
          typeof setDefaultOpenAIClient
        >[0]
      );
      setOpenAIAPI("chat_completions");
      setTracingDisabled(true);
    }

    const memories = await store.index();
    const memSection = memories
      .map((m) => `[${m.type}] ${m.name}\n${m.description}\n---\n${m.body}`)
      .join("\n\n");

    const agent = new Agent({
      name: "ci-agent",
      model: openaiModel,
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

    // 3b. Tool selection (write) — state a NEW fact in plain language and
    // require the model to persist it by *calling* remember_memory. The
    // store only mutates through that tool, so a row appearing proves the
    // model chose the tool (not just narrated saving). The token sku_7f3a
    // is unguessable, so the later recall can't pass by the model guessing.
    const writer = new Agent({
      name: "ci-writer",
      model: openaiModel,
      instructions:
        "You take notes. When the user shares a fact worth keeping, save it " +
        "with the remember_memory tool using a short kebab-case name.",
      tools: makeMemoryTools(store),
    });
    await run(
      writer,
      "Please remember this: the orders table has columns id, total, status, and sku_7f3a."
    );
    const persisted = (await store.index()).find((m) =>
      m.body.toLowerCase().includes("sku_7f3a")
    );
    assert.ok(persisted, "agent did not persist the fact via remember_memory");
    console.log(`[ci] tool-call remember ok — saved "${persisted.name}"`);

    // 3c. Tool selection (recall) — a fresh agent with NO memory injected
    // must call recall_memory to surface the just-saved fact.
    const reader = new Agent({
      name: "ci-reader",
      model: openaiModel,
      instructions:
        "Answer using your memory tools. Call recall_memory to look up what " +
        "the user asks about before answering.",
      tools: makeMemoryTools(store),
    });
    const recalled = await run(reader, "What columns does the orders table have?");
    assert.ok(
      (recalled.finalOutput ?? "").toLowerCase().includes("sku_7f3a"),
      `recall turn did not surface the saved fact: ${recalled.finalOutput}`
    );
    console.log("[ci] tool-call recall ok");
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
