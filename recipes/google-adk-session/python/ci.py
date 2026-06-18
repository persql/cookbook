"""Headless test: Google ADK sessions, events, and state persist via PerSQL.

Local mode  (default, no secrets): PerSQL(local=":memory:") — proves the
  session-service contract with no network, no LLM.
Remote mode (PERSQL_TOKEN + PERSQL_DATABASE set): claims a fresh branch per
  run for isolation, runs the same checks, deletes the branch on exit.

Exit 0 on pass, non-zero on failure. No interactive input.
"""

from __future__ import annotations

import asyncio
import os
import time

from dotenv import load_dotenv
from google.adk.events.event import Event
from google.adk.events.event_actions import EventActions
from google.genai import types
from persql import PerSQL

from google_adk_persql import PerSQLSessionService

load_dotenv()

TOKEN = os.environ.get("PERSQL_TOKEN")
DATABASE = os.environ.get("PERSQL_DATABASE")
RUN_ID = os.environ.get("GITHUB_RUN_ID") or str(int(time.time()))

mode = "remote" if TOKEN else "local"
print(f"[ci] mode={mode}")


def make_event(text: str, state_delta: dict | None = None) -> Event:
    return Event(
        id=Event.new_id(),
        invocation_id="inv-1",
        author="user",
        content=types.Content(role="user", parts=[types.Part(text=text)]),
        actions=EventActions(state_delta=state_delta or {}),
    )


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
        app, user = "app", "u1"

        # 1. Create a session, append an event with a state delta.
        service = PerSQLSessionService(db)
        created = await service.create_session(
            app_name=app, user_id=user, session_id="s1", state={"app:theme": "dark"}
        )
        assert created.state == {"app:theme": "dark"}, created.state
        await service.append_event(created, make_event("hello", state_delta={"count": 1}))
        print("[ci] event appended")

        # 2. A fresh service over the same database replays events and state —
        #    survives a process restart, not just an in-memory cache.
        resumed = PerSQLSessionService(db)
        got = await resumed.get_session(app_name=app, user_id=user, session_id="s1")
        assert got is not None, "session not found after restart"
        assert len(got.events) == 1, got.events
        assert got.events[0].content.parts[0].text == "hello", got.events[0]
        assert got.state == {"app:theme": "dark", "count": 1}, got.state
        print("[ci] session recovered by a fresh service")

        # 3. Sessions are isolated — another user has no session s1.
        other = await resumed.get_session(app_name=app, user_id="u2", session_id="s1")
        assert other is None, "session isolation broken"
        print("[ci] sessions isolated")

        # 4. Delete removes the session and its events.
        await resumed.delete_session(app_name=app, user_id=user, session_id="s1")
        gone = await resumed.get_session(app_name=app, user_id=user, session_id="s1")
        assert gone is None, "session survived delete"
        print("[ci] delete ok")

        print(f"[ci] PASS ({mode})")
    finally:
        if cleanup:
            await cleanup()


if __name__ == "__main__":
    asyncio.run(main())
