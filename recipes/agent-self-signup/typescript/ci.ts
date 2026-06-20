import "dotenv/config";
import assert from "node:assert/strict";
import { PerSQL } from "@persql/sdk";
import {
  FederateError,
  federateFromGitHubActions,
  hasGitHubOidc,
} from "./federate.js";

// Federation needs a real GitHub Actions OIDC token; there is no
// local-mode equivalent. Skip cleanly off-Actions (dev laptops, fork PRs
// where id-token: write isn't granted).
if (!hasGitHubOidc()) {
  console.log("[ci] no GitHub OIDC env — skipping (federate is Actions-only)");
  process.exit(0);
}

const apiUrl = process.env.PERSQL_API_URL ?? "https://api.persql.com";
console.log(`[ci] federating against ${apiUrl}`);

async function federate() {
  try {
    return await federateFromGitHubActions(apiUrl);
  } catch (e) {
    // During rollout the endpoint may not exist yet: POST /v1/identity/federate
    // then falls through to the /v1 bearer chain, which rejects the OIDC JWT
    // as a bad token (401 "Invalid token format") or 404. Treat route-absent
    // as skip-not-fail. A real failure from the *deployed* route says "OIDC
    // verification failed" — that must fail loudly, so it is never skipped.
    const routeAbsent =
      e instanceof FederateError &&
      (e.status === 404 || (e.status === 401 && !e.message.includes("OIDC")));
    if (routeAbsent) {
      console.log(
        `::warning::/v1/identity/federate not live yet (HTTP ${(e as FederateError).status}) — skipping`
      );
      process.exit(0);
    }
    throw e;
  }
}

// 1. Self-sign-up.
const ws = await federate();
assert.ok(ws.token, "federate returned no token");
assert.ok(ws.namespace && ws.database, "federate returned no workspace");
console.log(
  `[ci] signed up -> ${ws.namespace}/${ws.database} (created=${ws.created}, identity=${ws.identity})`
);

// 2. Idempotent: a second federate resolves to the SAME workspace and is
// no longer a fresh create.
const again = await federate();
assert.equal(again.namespace, ws.namespace, "second federate landed on a different namespace");
assert.equal(again.created, false, "second federate reported created=true");
console.log("[ci] idempotent re-federate ok");

// 3. The minted token actually works against the workspace.
const db = new PerSQL({ token: ws.token }).database(`${ws.namespace}/${ws.database}`);
await db.query(
  "CREATE TABLE IF NOT EXISTS ci_federate (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT DEFAULT (datetime('now')))"
);
await db.query("INSERT INTO ci_federate DEFAULT VALUES");
const res = await db.query<{ total: number }>("SELECT count(*) AS total FROM ci_federate");
assert.ok((res.data[0]?.total ?? 0) >= 1, "row count did not increase");
console.log(`[ci] query ok — ci_federate has ${res.data[0].total} row(s)`);

console.log("[ci] PASS (remote/federate)");
