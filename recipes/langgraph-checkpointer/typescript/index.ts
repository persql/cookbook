import "dotenv/config";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { PerSQL } from "@persql/sdk";
import { PerSQLSaver } from "@persql/langgraph";

const apiKey = process.env.OPENAI_API_KEY;
const token = process.env.PERSQL_TOKEN;
const database = process.env.PERSQL_DATABASE;
if (!apiKey || !token || !database) {
  console.error("Set OPENAI_API_KEY, PERSQL_TOKEN, and PERSQL_DATABASE in .env");
  process.exit(1);
}

const model = new ChatOpenAI({
  model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  apiKey,
  // Optional OpenAI-compatible gateway. Unset → the default OpenAI API.
  ...(process.env.OPENAI_BASE_URL
    ? { configuration: { baseURL: process.env.OPENAI_BASE_URL } }
    : {}),
});

const persql = new PerSQL({ token });
const checkpointer = new PerSQLSaver(persql.database(database));
const agent = createReactAgent({ llm: model, tools: [], checkpointer });

// One thread_id = one durable conversation. Re-running the script with the
// same id replays the stored state, so the agent remembers across restarts.
const threadId = process.env.THREAD_ID || "session-1";
const config = { configurable: { thread_id: threadId } };

const rl = readline.createInterface({ input, output });
console.log(`LangGraph agent ready (thread "${threadId}"). Type a message or "exit".\n`);

while (true) {
  const userInput = await rl.question("> ");
  if (userInput.trim().toLowerCase() === "exit") break;
  const result = await agent.invoke({ messages: [{ role: "user", content: userInput }] }, config);
  const last = result.messages.at(-1);
  const text = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content);
  console.log(`\n${text}\n`);
}

rl.close();
