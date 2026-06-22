# Hermes Memory

Back a [Hermes Agent](https://hermes-agent.nousresearch.com) (Nous Research) with
PerSQL, so its memory is portable across machines, durable across ephemeral
runs, and queryable as SQL — instead of a local `~/.hermes/state.db`.

`hermes-persql` is a Hermes **memory provider**. Hermes records each turn and
recalls relevant prior turns and facts on every message; this provider routes
that into a PerSQL database — one isolated SQLite per agent. Recall is keyword
(FTS5), matching Hermes' own session search (no vector database).

## Use it in Hermes

```
pip install hermes-persql
hermes-persql install            # writes ~/.hermes/plugins/persql/
```

```yaml
# ~/.hermes/config.yaml
memory:
  provider: persql
```

```
export PERSQL_TOKEN="psql_live_…"
export PERSQL_DATABASE="<workspace>/<slug>"
```

Then `hermes chat` — every turn persists to PerSQL and is recalled across
sessions and machines.

## Pattern

Hermes drives the provider; the provider reads and writes a `PerSQLMemoryStore`:

| Hermes calls | provider | stores |
|---|---|---|
| `sync_turn(user, assistant)` | `record_turn` | a row in `hermes_turns` (+ FTS5 index) |
| `prefetch(query)` / `persql_recall` | `recall` | keyword search over turns + facts |
| `persql_remember(fact)` | `remember` | a row in `hermes_facts` |
| `persql_profile` | `list_facts` | all stored facts |

## Implementations

| Language | Package | File |
|---|---|---|
| Python | `hermes-persql` | [python/](python/) |

## What you'll see

`main.py` drives the provider directly (no Hermes process, no LLM) and prints
what it stores and recalls — exactly the methods Hermes calls. The headless
`ci.py` proves the same thing as assertions: a turn and a fact persist, are
recalled by keyword and recovered by a fresh store, and recall stays bounded.

## Inspect it as SQL

Memory is rows — query it from the console, MCP, or any SDK:

```sql
SELECT session_id, COUNT(*) FROM hermes_turns GROUP BY session_id;
SELECT fact FROM hermes_facts ORDER BY id DESC;
```
