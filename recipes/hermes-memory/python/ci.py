"""Headless test: Hermes agent memory persists via PerSQL.

Local mode  (default, no secrets): PerSQL(local=":memory:") — proves the
  memory store contract with no network, no LLM.
Remote mode (PERSQL_TOKEN + PERSQL_DATABASE set): claims a fresh branch per
  run for isolation, runs the same checks, deletes the branch on exit.

`hermes-persql` is a Hermes memory provider; under the hood it reads and writes
a PerSQLMemoryStore. Hermes calls sync_turn -> record_turn, prefetch /
persql_recall -> recall, and persql_remember -> remember. This script exercises
that store the way the provider does.

Exit 0 on pass, non-zero on failure. No interactive input.
"""

from __future__ import annotations

import os
import time

from dotenv import load_dotenv
from persql import PerSQL

from hermes_persql import PerSQLMemoryStore

load_dotenv()

TOKEN = os.environ.get("PERSQL_TOKEN")
DATABASE = os.environ.get("PERSQL_DATABASE")
RUN_ID = os.environ.get("GITHUB_RUN_ID") or str(int(time.time()))

mode = "remote" if TOKEN else "local"
print(f"[ci] mode={mode}")


def main() -> None:
    cleanup = None

    if TOKEN and DATABASE:
        parent = PerSQL(token=TOKEN)
        branch_ref = os.environ.get("PERSQL_BRANCH_REF") or f"ci-{RUN_ID}"
        claimed = parent.database(DATABASE).branches.claim(
            ref=branch_ref, role="admin", ttl_sec=3600
        )
        db = PerSQL(token=claimed["token"]).database(
            f"{claimed['namespace_slug']}/{claimed['database_slug']}"
        )

        def cleanup() -> None:
            parent.database(DATABASE).branches.delete(branch_ref)
            print("[ci] branch cleaned up")
    else:
        db = PerSQL(local=":memory:").database("test/ci")

    try:
        store = PerSQLMemoryStore(db)
        store.ensure_setup()

        # 1. A turn (Hermes sync_turn) is persisted and recalled by keyword.
        store.record_turn("s1", "What is PerSQL?", "An isolated SQLite database per agent, on the edge.")
        assert any("edge" in h for h in store.recall("PerSQL edge")), "turn not recalled"
        print("[ci] turn recorded and recalled (FTS5)")

        # 2. A durable fact (Hermes persql_remember) is stored, listed, recalled.
        store.remember("The user prefers PerSQL for agent memory.", session_id="s1")
        assert store.list_facts() == ["The user prefers PerSQL for agent memory."], "fact not listed"
        assert any("PerSQL" in h for h in store.recall("agent memory")), "fact not recalled"
        print("[ci] fact stored, listed, and recalled")

        # 3. A fresh store over the same database replays everything — survives a
        #    process restart, not an in-memory cache.
        resumed = PerSQLMemoryStore(db)
        assert resumed.recent_turns("s1"), "memory not found after restart"
        print("[ci] memory recovered by a fresh store")

        # 4. Recall is lexical and bounded — an unrelated query returns nothing.
        assert resumed.recall("quantum chromodynamics") == [], "recall not bounded"
        print("[ci] recall bounded")

        print(f"[ci] PASS ({mode})")
    finally:
        if cleanup:
            cleanup()


if __name__ == "__main__":
    main()
