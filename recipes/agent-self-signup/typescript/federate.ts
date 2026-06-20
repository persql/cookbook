// Federated machine-identity signup against PerSQL. Inside a GitHub
// Actions job with `permissions: id-token: write`, an agent can mint a
// GitHub OIDC token and exchange it for its own PerSQL workspace -- no
// stored secret, no app install, no human. This is the App-less sibling
// of `persql/setup-db` (which binds a repo to a pre-installed workspace).

export interface FederatedWorkspace {
  token: string;
  url: string;
  namespace: string;
  database: string;
  identity: string;
  created: boolean;
  expiresAt: string;
}

export class FederateError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "FederateError";
  }
}

const AUDIENCE = "persql";

export function hasGitHubOidc(): boolean {
  return !!(
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL &&
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  );
}

export async function federateFromGitHubActions(
  apiUrl = process.env.PERSQL_API_URL ?? "https://api.persql.com"
): Promise<FederatedWorkspace> {
  const reqUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const reqToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!reqUrl || !reqToken) {
    throw new FederateError(
      "No GitHub OIDC env — run inside a GitHub Actions job with `permissions: id-token: write`.",
      0
    );
  }

  // 1. Mint a GitHub OIDC token bound to this run, audience "persql".
  const oidcRes = await fetch(`${reqUrl}&audience=${AUDIENCE}`, {
    headers: { Authorization: `Bearer ${reqToken}` },
  });
  if (!oidcRes.ok) {
    throw new FederateError(`OIDC token request failed: ${oidcRes.status}`, oidcRes.status);
  }
  const { value: oidc } = (await oidcRes.json()) as { value: string };

  // 2. Exchange it for a self-owned PerSQL workspace.
  const res = await fetch(`${apiUrl}/v1/identity/federate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${oidc}` },
  });
  const body = (await res.json().catch(() => ({}))) as
    | { success: true; data: FederatedWorkspace }
    | { success: false; error: string };
  if (!res.ok || !body.success) {
    const reason = "success" in body && !body.success ? body.error : `HTTP ${res.status}`;
    throw new FederateError(`federate failed: ${reason}`, res.status);
  }
  return body.data;
}
