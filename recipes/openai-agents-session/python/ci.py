"""Headless test: OpenAI Agents SDK session history persists via PerSQL.

Local mode  (default, no secrets): PerSQL(local=":memory:") — proves the
  session contract with no network, no LLM.
Remote mode (PERSQL_TOKEN + PERSQL_DATABASE set): claims a fresh branch per
  run for isolation, runs the same checks, deletes the branch on exit.

Exit 0 on pass, non-zero on failure. No interactive input.
"""

from __future__ import annotations

import asyncio
import os
import time

from dotenv import load_dotenv
from persql import PerSQL

from openai_agents_persql import PerSQLSession

load_dotenv()

TOKEN = os.environ.get("PERSQL_TOKEN")
DATABASE = os.environ.get("PERSQL_DATABASE")
RUN_ID = os.environ.get("GITHUB_RUN_ID") or str(int(time.time()))

mode = "remote" if TOKEN else "local"
print(f"[ci] mode={mode}")


def msg(role: str, content: str) -> dict[str, str]:
    return {"role": role, "content": content}


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
        # 1. Append a turn the way Runner does, then read it back in order.
        session = PerSQLSession("user-1", db)
        await session.add_items([msg("user", "I prefer metric units."), msg("assistant", "Got it.")])
        items = await session.get_items()
        assert len(items) == 2, items
        assert items[0]["content"] == "I prefer metric units.", items[0]
        print("[ci] history round-trips")

        # 2. A fresh session over the same database and id replays the stored
        #    history — survives a process restart, not just an in-memory cache.
        resumed = PerSQLSession("user-1", db)
        replayed = await resumed.get_items()
        assert len(replayed) == 2, replayed
        print("[ci] history recovered by a fresh session")

        # 3. Sessions are isolated — a different id sees nothing.
        other = PerSQLSession("user-2", db)
        assert await other.get_items() == [], "session isolation broken"
        print("[ci] sessions isolated")

        # 4. clear_session wipes one session's history.
        await resumed.clear_session()
        assert await resumed.get_items() == [], "clear_session left items"
        print("[ci] clear_session ok")

        print(f"[ci] PASS ({mode})")
    finally:
        if cleanup:
            await cleanup()


if __name__ == "__main__":
    asyncio.run(main())
