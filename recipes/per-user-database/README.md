# Per-User Database (Dart / Flutter)

Sign a user in with PerSQL and give each one their own private cloud database
— provisioned in *their* account, not yours. This is the `database` OAuth scope
(OAuth 2.1 + PKCE), and it's the natural fit for a Flutter or Dart app where
every user should own their data.

## Pattern

1. `PerSQL.beginConnect(...)` builds an `/oauth/authorize` URL plus a PKCE
   verifier and CSRF `state` to keep.
2. Open the URL; the user approves and is redirected back with a `code`.
3. `PerSQL.completeConnect(...)` exchanges the `code` for a `psql_live_…` token
   scoped to the user's own database — `grant.database` is ready to query.

```dart
import 'package:persql/persql.dart';

final req = PerSQL.beginConnect(
  clientId: 'psqlrp_…',
  redirectUri: 'https://app.example.com/callback',
  scope: 'database',
);
// open req.url; keep req.codeVerifier + req.state

final persql = await PerSQL.completeConnect(
  clientId: 'psqlrp_…',
  redirectUri: 'https://app.example.com/callback',
  code: codeFromRedirect,
  codeVerifier: req.codeVerifier,
);

final db = persql.database(persql.grant!.database);
await db.query('INSERT INTO notes (body) VALUES (?)', params: ['hi']);
```

In a **Flutter app**, open `req.url` with
[`flutter_web_auth_2`](https://pub.dev/packages/flutter_web_auth_2) and read the
`code` + `state` off the returned redirect — then compare `state` to `req.state`
before exchanging the code. This recipe pastes the code by hand so the flow runs
from a terminal. The same `beginConnect` / `completeConnect` helpers exist in the
TypeScript (`@persql/sdk`) and Python (`persql`) SDKs.

## What you'll see

```
1. Open this URL and approve access:
   https://api.persql.com/oauth/authorize?response_type=code&client_id=…

2. Paste the `code` from the redirect URL: <code>

Signed in as user@example.com → user-3f9c/app-data

notes:
  1: saved from Dart
```

## CI

`bin/ci.dart` always verifies the offline half — that `beginConnect` produces a
correct PKCE authorize URL. The Dart SDK has no local SQLite mode, so the live
half (query / batch / `tables`) runs only when CI provisions a real database;
it isolates inside that database with a run-scoped table and drops it on exit.

## Run it

```sh
cd dart
cp .env.example .env   # add your OAuth client id + redirect uri
dart pub get
dart run bin/main.dart   # interactive sign-in
dart run bin/ci.dart     # headless checks
```
