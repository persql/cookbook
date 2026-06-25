import "dotenv/config";
import { PerSQL } from "@persql/sdk";

// Data agents are scheduled LLM loops welded to one database. They require a
// real (remote) PerSQL database and an admin-role token — there is no local
// mode for `db.agents`.
const token = process.env.PERSQL_TOKEN;
const database = process.env.PERSQL_DATABASE;

if (!token || !database) {
  console.error(
    "Set PERSQL_TOKEN (admin) and PERSQL_DATABASE=ns/slug — see .env.example."
  );
  process.exit(1);
}

const persql = new PerSQL({ token });
const db = persql.database(database);

// A tiny table for the agent to report on.
await db.query(
  "CREATE TABLE IF NOT EXISTS widgets (id INTEGER PRIMARY KEY, name TEXT, price REAL)"
);
const { data: countRows } = await db.query<{ n: number }>(
  "SELECT count(*) AS n FROM widgets"
);
if ((countRows[0]?.n ?? 0) === 0) {
  await db.query(
    "INSERT INTO widgets (name, price) VALUES ('bolt', 0.5), ('gear', 3.25), ('spring', 1.1)"
  );
}

console.log("Creating a data agent…");
const agent = await db.agents.create({
  name: "widget-reporter",
  goal:
    "Inspect the widgets table and report how many widgets exist and the " +
    "total of their prices. Do not modify any data.",
  intervalSec: 3600, // hourly
  approvalMode: "writes", // belt-and-braces: any write would pause for a human
  maxIters: 3,
});
console.log(`  → ${agent.name} (${agent.id.slice(0, 8)}), every 1h`);

console.log("Running one cycle now…");
const ran = await db.agents.run(agent.id);
console.log(`  status: ${ran.lastStatus}`);
console.log(`  summary: ${ran.lastSummary ?? "(model produced no summary)"}`);
console.log(
  `  rounds=${ran.lastRounds ?? 0} read=${ran.lastRowsRead ?? 0} written=${ran.lastRowsWritten ?? 0}`
);

const { data: agents } = await db.agents.list();
console.log(`Agents on ${database}: ${agents.map((a) => a.name).join(", ")}`);

// Clean up so re-running the demo stays idempotent.
await db.agents.delete(agent.id);
console.log("Deleted the demo agent.");
