import 'dart:io';

import 'package:persql/persql.dart';

/// Headless check for the per-user-database recipe.
///
/// The Dart SDK is a thin `/v1` client — no local `:memory:` mode and no
/// branch API. So this script always runs the offline PKCE checks, and runs
/// the live half only when a real database is provided (isolating inside it
/// with a run-scoped table, since there is no branch to claim).
Future<void> main() async {
  // 1. Offline: beginConnect builds a valid OAuth 2.1 + PKCE authorize URL.
  final req = PerSQL.beginConnect(
    clientId: 'psqlrp_s00_demo',
    redirectUri: 'https://app.example.com/callback',
    scope: 'database',
  );
  final u = Uri.parse(req.url);
  _expect(u.path == '/oauth/authorize', 'authorize path');
  _expect(u.queryParameters['response_type'] == 'code', 'response_type=code');
  _expect(u.queryParameters['scope'] == 'database', 'scope=database');
  _expect(u.queryParameters['code_challenge_method'] == 'S256', 'S256 challenge');
  _expect((u.queryParameters['code_challenge'] ?? '').isNotEmpty, 'code_challenge set');
  _expect(u.queryParameters['state'] == req.state, 'state echoed for CSRF');
  _expect(req.codeVerifier.isNotEmpty, 'verifier kept for exchange');
  print('[ci] beginConnect builds a PKCE authorize URL ok');

  final token = Platform.environment['PERSQL_TOKEN'];
  final database = Platform.environment['PERSQL_DATABASE'];
  final baseUrl = Platform.environment['PERSQL_API_URL'];

  if (token == null || token.isEmpty || database == null || database.isEmpty) {
    print('[ci] no PERSQL_TOKEN — ran offline checks only (PASS)');
    return;
  }

  print('[ci] mode=remote db=$database');
  final persql = PerSQL(
    token: token,
    baseUrl: baseUrl == null || baseUrl.isEmpty ? defaultBaseUrl : baseUrl,
  );
  final db = persql.database(database);

  final runId = Platform.environment['GITHUB_RUN_ID'] ??
      DateTime.now().microsecondsSinceEpoch.toString();
  final table = 'cookbook_$runId';
  try {
    await db.query(
      'CREATE TABLE IF NOT EXISTS $table '
      '(id INTEGER PRIMARY KEY, owner TEXT NOT NULL, note TEXT NOT NULL)',
    );

    // 2. What a signed-in user's app does against their own database.
    final written = await db.batch([
      Statement('INSERT INTO $table (owner, note) VALUES (?, ?)', ['alice', 'first']),
      Statement('INSERT INTO $table (owner, note) VALUES (?, ?)', ['alice', 'second']),
    ], transaction: true);
    _expect(written.every((r) => r.rowsWritten == 1), 'batch wrote each row');

    final mine = await db.query(
      'SELECT note FROM $table WHERE owner = ? ORDER BY id',
      params: ['alice'],
    );
    _expect(
      mine.data.map((r) => r['note']).join(',') == 'first,second',
      'rows round-trip in order',
    );

    final tables = await db.tables();
    _expect(tables.any((t) => t.name == table), 'table is listed');

    print('[ci] live query + batch + tables ok');
    print('[ci] PASS (remote)');
  } finally {
    await db.query('DROP TABLE IF EXISTS $table');
    persql.close();
  }
}

void _expect(bool ok, String what) {
  if (!ok) {
    stderr.writeln('[ci] FAIL: $what');
    exit(1);
  }
}
