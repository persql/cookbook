import "dotenv/config";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import OpenAI from "openai";
import {
  Agent,
  run,
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled,
} from "@openai/agents";
import { PerSQL } from "@persql/sdk";
import { PerSQLSession } from "@persql/openai-agents";

const apiKey = process.env.OPENAI_API_KEY;
const token = process.env.PERSQL_TOKEN;
const database = process.env.PERSQL_DATABASE;
if (!apiKey || !token || !database) {
  console.error("Set OPENAI_API_KEY, PERSQL_TOKEN, and PERSQL_DATABASE in .env");
  process.exit(1);
}

// Optional OpenAI-compatible gateway. Unset → the SDK's default OpenAI API.
if (process.env.OPENAI_BASE_URL) {
  setDefaultOpenAIClient(
    new OpenAI({ apiKey, baseURL: process.env.OPENAI_BASE_URL }) as unknown as Parameters<
      typeof setDefaultOpenAIClient
    >[0]
  );
  setOpenAIAPI("chat_completions");
  setTracingDisabled(true);
}

const persql = new PerSQL({ token });
// One session id = one durable conversation history. Re-running the script
// with the same id replays the stored turns to the model automatically.
const sessionId = process.env.SESSION_ID || "user-1";
const session = new PerSQLSession(sessionId, persql.database(database));

const agent = new Agent({
  name: "Assistant",
  model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  instructions: "You are a concise, helpful assistant. Use the conversation history.",
});

const rl = readline.createInterface({ input, output });
console.log(`Agent ready (session "${sessionId}"). Type a message or "exit".\n`);

while (true) {
  const userInput = await rl.question("> ");
  if (userInput.trim().toLowerCase() === "exit") break;
  const result = await run(agent, userInput, { session });
  console.log(`\n${result.finalOutput}\n`);
}

rl.close();
