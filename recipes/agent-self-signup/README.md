# Agent self-signup (federated machine identity)

Let an agent **sign itself up** for PerSQL — no human, no email, no app install.
Inside a GitHub Actions job, the agent mints a GitHub OIDC token and exchanges
it at `POST /v1/identity/federate` for its own workspace: a namespace, a `main`
database, a small starting credit, and a scoped token.

This is the App-less sibling of [`persql/setup-db`](https://github.com/persql/setup-db):
`setup-db` binds a repo to a workspace you pre-installed the PerSQL GitHub App on;
federation needs **no install** — the OIDC token alone is the identity, and the
identity gets its *own* workspace. Any verifiable OIDC issuer can plug in; GitHub
Actions is wired today.

## Pattern

1. Mint a GitHub OIDC token bound to this run, with audience `persql`
   (`id-token: write` exposes `ACTIONS_ID_TOKEN_REQUEST_URL` / `_TOKEN`).
2. `POST /v1/identity/federate` with `Authorization: Bearer <oidc>`.
3. Get back `{ token, url, namespace, database, created, expiresAt }` and use the
   token like any other PerSQL token.

```ts
import { PerSQL } from "@persql/sdk";
import { federateFromGitHubActions } from "./federate.js";

const ws = await federateFromGitHubActions();          // self-signup
const db = new PerSQL({ token: ws.token })
  .database(`${ws.namespace}/${ws.database}`);
await db.query("INSERT INTO visits DEFAULT VALUES");   // use it
```

The call is **idempotent per identity**: the first federate provisions the
workspace (`created: true`); every later call resolves to the same workspace
(`created: false`) and mints a fresh token — so a workflow can call it on every
run without piling up workspaces.

## CI

`ci.ts` runs headless. It **skips** off-Actions (no OIDC token to mint — dev
laptops, fork PRs), and against the live API it: signs up, re-federates to prove
idempotency lands on the same namespace, then queries with the minted token to
prove the workspace works. Point it at staging with `PERSQL_API_URL`.

## Run it

```sh
cd typescript
npm install
PERSQL_API_URL=https://api-staging.persql.com npx tsx ci.ts   # inside GitHub Actions
```
