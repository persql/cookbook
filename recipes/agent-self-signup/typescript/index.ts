// Runnable example: an agent signs itself up and uses its workspace.
// Run inside a GitHub Actions job (permissions: id-token: write) — there
// is no local equivalent, because the GitHub OIDC token is the auth.
import { PerSQL } from "@persql/sdk";
import { federateFromGitHubActions, hasGitHubOidc } from "./federate.js";

if (!hasGitHubOidc()) {
  console.log("Run this inside GitHub Actions with `permissions: id-token: write`.");
  process.exit(0);
}

const ws = await federateFromGitHubActions();
console.log(`Signed up as ${ws.identity} -> ${ws.namespace}/${ws.database} (created=${ws.created})`);

const db = new PerSQL({ token: ws.token }).database(`${ws.namespace}/${ws.database}`);
await db.query(
  "CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT DEFAULT (datetime('now')))"
);
await db.query("INSERT INTO visits DEFAULT VALUES");
const res = await db.query<{ total: number }>("SELECT count(*) AS total FROM visits");
console.log(`visits so far: ${res.data[0]?.total}`);
