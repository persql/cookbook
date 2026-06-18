import "dotenv/config";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Agent, run } from "@openai/agents";
import { PerSQL } from "@persql/sdk";
import { context, memoryTools } from "@persql/context";

const token = process.env.PERSQL_TOKEN;
const database = process.env.PERSQL_DATABASE;
if (!token || !database) {
  console.error("Set PERSQL_TOKEN and PERSQL_DATABASE in .env");
  process.exit(1);
}

// One context store per agent / team / project. The database is
// created automatically the first time you write to it.
const persql = new PerSQL({ token });
const store = context(persql.database(database), { source: "agent-memory-recipe" });
await store.init();

// Load full memory bodies into the system prompt so the model can
// answer known questions directly — no recall tool call needed.
const memories = await store.recall("", { limit: 50 });

// Fall back to index (name + description only) when there are no bodies yet.
const memSection =
  memories.length > 0
    ? memories
        .map((m) => `[${m.type}] ${m.name}\n${m.description}\n---\n${m.body}`)
        .join("\n\n")
    : (await store.index())
        .map((m) => `[${m.type}] ${m.name} — ${m.description}`)
        .join("\n") || "No memories saved yet.";

const agent = new Agent({
  name: "assistant",
  model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  instructions: `You are a helpful assistant with persistent memory.

MEMORIES — facts saved from previous sessions. Answer questions covered here directly without calling any tool first:

${memSection}

Use remember_memory to save new facts worth keeping (schema details, preferences, decisions).
Use recall_memory to search for something not shown above.
Use forget_memory to remove stale entries.`,
  tools: memoryTools(store),
});

// Simple REPL — type "exit" to quit.
const rl = readline.createInterface({ input, output });
console.log('Agent ready. Type a message or "exit" to quit.\n');

while (true) {
  const userInput = await rl.question("> ");
  if (userInput.trim().toLowerCase() === "exit") break;

  const result = await run(agent, userInput);
  console.log(`\n${result.finalOutput}\n`);
}

rl.close();
