import "dotenv/config";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import OpenAI from "openai";
import { Agent, run, setDefaultOpenAIClient } from "@openai/agents";
import { PerSQL } from "@persql/sdk";
import { MemoryStore, makeMemoryTools } from "./memory.js";

const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const cfApiToken = process.env.CLOUDFLARE_API_TOKEN;
const persqlToken = process.env.PERSQL_TOKEN;
const database = process.env.PERSQL_DATABASE;
if (!cfAccountId || !cfApiToken || !persqlToken || !database) {
  console.error(
    "Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, PERSQL_TOKEN, and PERSQL_DATABASE in .env"
  );
  process.exit(1);
}

// Cast needed: @openai/agents bundles its own openai sub-dep; the types
// are structurally identical but TypeScript treats them as distinct.
setDefaultOpenAIClient(
  new OpenAI({
    apiKey: cfApiToken,
    baseURL: `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/ai/v1`,
  }) as Parameters<typeof setDefaultOpenAIClient>[0]
);

const persql = new PerSQL({ token: persqlToken });
const store = new MemoryStore(persql.database(database));
await store.init();

const memories = await store.index();
const memSection =
  memories.length > 0
    ? memories
        .map((m) => `[${m.type}] ${m.name}\n${m.description}\n---\n${m.body}`)
        .join("\n\n")
    : "No memories saved yet.";

const agent = new Agent({
  name: "assistant",
  model: "@cf/meta/llama-3.3-70b-instruct",
  instructions: `You are a helpful assistant with persistent memory.

MEMORIES — facts saved from previous sessions. Answer questions covered here directly without calling any tool first:

${memSection}

Use remember_memory to save new facts worth keeping (schema details, preferences, decisions).
Use recall_memory to search for something not shown above.
Use forget_memory to remove stale entries.`,
  tools: makeMemoryTools(store),
});

const rl = readline.createInterface({ input, output });
console.log('Agent ready. Type a message or "exit" to quit.\n');

while (true) {
  const userInput = await rl.question("> ");
  if (userInput.trim().toLowerCase() === "exit") break;
  const result = await run(agent, userInput);
  console.log(`\n${result.finalOutput}\n`);
}

rl.close();
