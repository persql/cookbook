"""See the Hermes memory provider in action — the methods Hermes itself calls.

`hermes-persql` plugs into Hermes as a memory provider. This script drives that
provider directly (no Hermes process, no LLM) so you can watch what it stores
and recalls. To use it inside real Hermes:

    pip install hermes-persql
    hermes-persql install                  # ~/.hermes/plugins/persql/
    # ~/.hermes/config.yaml -> memory.provider: persql
    export PERSQL_TOKEN=...  PERSQL_DATABASE=<workspace>/<slug>
    hermes chat

Run this demo: set the same env (or a .env), then `uv run python main.py`.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv

from hermes_persql import PerSQLMemoryProvider

load_dotenv()

if not (os.environ.get("PERSQL_TOKEN") and os.environ.get("PERSQL_DATABASE")):
    raise SystemExit(
        "Set PERSQL_TOKEN and PERSQL_DATABASE — the provider talks to a real "
        "PerSQL database, like Hermes does. For an offline contract check, run ci.py."
    )

provider = PerSQLMemoryProvider()
print("available:", provider.is_available())
provider.initialize("demo-session")
print(provider.system_prompt_block())

# Hermes calls sync_turn after each completed turn.
provider.sync_turn(
    "What is PerSQL?",
    "An isolated SQLite database per agent, on the edge.",
    session_id="demo-session",
)
print("\n[stored a turn]")

# Hermes calls prefetch before the next turn; the result is injected into context.
print("\nprefetch('edge database'):")
print(provider.prefetch("edge database", session_id="demo-session") or "(nothing yet)")

# The model can also call the memory tools itself.
print("\npersql_remember:", provider.handle_tool_call(
    "persql_remember", {"fact": "The user is evaluating PerSQL for Hermes memory."}))
print("persql_recall: ", provider.handle_tool_call(
    "persql_recall", {"query": "evaluating PerSQL"}))
print("persql_profile:", provider.handle_tool_call("persql_profile", {}))

provider.shutdown()
print("\nInspect it as SQL: SELECT * FROM hermes_turns;  SELECT * FROM hermes_facts;")
