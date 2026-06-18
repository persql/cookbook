"""Headless test: Microsoft Agent Framework message history persists via PerSQL.

Local mode  (default, no secrets): PerSQL(local=":memory:") — proves the
  history-provider contract with no network, no LLM.
Remote mode (PERSQL_TOKEN + PERSQL_DATABASE set): claims a fresh branch per
  run for isolation, runs the same checks, deletes the branch on exit.

Exit 0 on pass, non-zero on failure. No interactive input.
"""

from __future__ import annotations

import asyncio
import os
import time

from agent_framework import Message
from dotenv import load_dotenv
from persql import PerSQL

from agent_framework_persql import PerSQLHistoryProvider

load_dotenv()

TOKEN = os.environ.get("PERSQL_TOKEN")
DATABASE = os.environ.get("PERSQL_DATABASE")
RUN_ID = os.environ.get("GITHUB_RUN_ID") or str(int(time.time()))

mode = "remote" if TOKEN else "local"
print(f"[ci] mode={mode}")


async def main() -> None:
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

        async def cleanup() -> None:
            parent.database(DATABASE).branches.delete(branch_ref)
            print("[ci] branch cleaned up")
    else:
        db = PerSQL(local=":memory:").database("test/ci")

    try:
        # 1. Save a turn, read it back in order.
        provider = PerSQLHistoryProvider(db)
        await provider.save_messages(
            "s1",
            [Message(role="user", contents=["hi"]), Message(role="assistant", contents=["hello"])],
        )
        messages = await provider.get_messages("s1")
        assert [m.role for m in messages] == ["user", "assistant"], messages
        assert [m.text for m in messages] == ["hi", "hello"], messages
        print("[ci] history round-trips")

        # 2. A fresh provider over the same database replays the messages —
        #    survives a process restart, not just an in-memory cache.
        resumed = PerSQLHistoryProvider(db)
        replayed = await resumed.get_messages("s1")
        assert [m.text for m in replayed] == ["hi", "hello"], replayed
        print("[ci] history recovered by a fresh provider")

        # 3. Sessions are isolated — a different id sees nothing.
        assert await resumed.get_messages("s2") == [], "session isolation broken"
        print("[ci] sessions isolated")

        # 4. clear wipes one session's history.
        await resumed.clear("s1")
        assert await resumed.get_messages("s1") == [], "clear left messages"
        print("[ci] clear ok")

        print(f"[ci] PASS ({mode})")
    finally:
        if cleanup:
            await cleanup()


if __name__ == "__main__":
    asyncio.run(main())
