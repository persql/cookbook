import 'dart:io';

import 'package:persql/persql.dart';

/// Sign in with PerSQL, then use the database provisioned in the user's own
/// account (the `database` OAuth scope).
///
/// In a Flutter app you'd open `req.url` with `flutter_web_auth_2` and read
/// the `code` + `state` straight off the returned redirect. Here we paste the
/// code by hand so the flow is runnable from a terminal.
Future<void> main() async {
  final clientId = Platform.environment['PERSQL_CLIENT_ID'];
  final redirectUri = Platform.environment['PERSQL_REDIRECT_URI'];
  final baseUrl = Platform.environment['PERSQL_API_URL'];
  if (clientId == null || redirectUri == null) {
    stderr.writeln(
      'Set PERSQL_CLIENT_ID and PERSQL_REDIRECT_URI first (see .env.example).',
    );
    exit(1);
  }
  final api = baseUrl == null || baseUrl.isEmpty ? defaultBaseUrl : baseUrl;

  // 1. Begin: build the authorize URL, keep the PKCE verifier + CSRF state.
  final req = PerSQL.beginConnect(
    clientId: clientId,
    redirectUri: redirectUri,
    scope: 'database',
    baseUrl: api,
  );
  print('1. Open this URL and approve access:\n   ${req.url}\n');
  stdout.write('2. Paste the `code` from the redirect URL: ');
  final code = stdin.readLineSync()?.trim();
  if (code == null || code.isEmpty) {
    stderr.writeln('No code provided.');
    exit(1);
  }
  // In production also read `state` off the redirect and check it == req.state.

  // 3. Exchange the code for a token scoped to exactly this user's database.
  final persql = await PerSQL.completeConnect(
    clientId: clientId,
    redirectUri: redirectUri,
    code: code,
    codeVerifier: req.codeVerifier,
    baseUrl: api,
  );
  final grant = persql.grant!;
  print('\nSigned in as ${grant.userEmail ?? 'a user'} → ${grant.database}\n');

  // 4. Use it. This database lives in the user's namespace, not yours.
  final db = persql.database(grant.database);
  await db.query(
    'CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)',
  );
  await db.query('INSERT INTO notes (body) VALUES (?)', params: ['saved from Dart']);
  final res = await db.query('SELECT id, body FROM notes ORDER BY id');
  print('notes:');
  for (final row in res.data) {
    print('  ${row['id']}: ${row['body']}');
  }
  persql.close();
}
