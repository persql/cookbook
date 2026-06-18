"""Headless test: AWS Strands session state persists via PerSQL.

Local mode  (default, no secrets): PerSQL(local=":memory:") — proves the
  session-repository contract with no network, no LLM.
Remote mode (PERSQL_TOKEN + PERSQL_DATABASE set): claims a fresh branch per
  run for isolation, runs the same checks, deletes the branch on exit.

The Strands repository contract is synchronous, so this script is too.
Exit 0 on pass, non-zero on failure. No interactive input.
"""

from __future__ import annotations

import os
import time

from dotenv import load_dotenv
from persql import PerSQL
from strands.types.session import Session, SessionAgent, SessionMessage, SessionType

from strands_persql import PerSQLSessionRepository

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
        # 1. Create a session, an agent under it, and a message.
        repo = PerSQLSessionRepository(db)
        repo.create_session(Session(session_id="s1", session_type=SessionType.AGENT))
        repo.create_agent(
            "s1", SessionAgent(agent_id="a1", state={}, conversation_manager_state={})
        )
        repo.create_message(
            "s1", "a1", SessionMessage(message={"role": "user", "content": [{"text": "hi"}]}, message_id=0)
        )
        print("[ci] session, agent, and message created")

        # 2. A fresh repository over the same database replays everything —
        #    survives a process restart, not just an in-memory cache.
        resumed = PerSQLSessionRepository(db)
        assert resumed.read_session("s1") is not None, "session not found after restart"
        messages = resumed.list_messages("s1", "a1")
        assert len(messages) == 1, messages
        assert messages[0].message["content"][0]["text"] == "hi", messages[0]
        print("[ci] state recovered by a fresh repository")

        # 3. Sessions are isolated — an unknown id reads back nothing.
        assert resumed.read_session("missing") is None, "session isolation broken"
        print("[ci] sessions isolated")

        # 4. Delete removes the session and its agents/messages.
        resumed.delete_session("s1")
        assert resumed.read_session("s1") is None, "session survived delete"
        print("[ci] delete ok")

        print(f"[ci] PASS ({mode})")
    finally:
        if cleanup:
            cleanup()


if __name__ == "__main__":
    main()
