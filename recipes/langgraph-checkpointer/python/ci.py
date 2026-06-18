"""Headless test: a real LangGraph graph persists state via PerSQL.

Local mode  (default, no secrets): PerSQL(local=":memory:") — proves the
  checkpointer contract with no network, no LLM.
Remote mode (PERSQL_TOKEN + PERSQL_DATABASE set): claims a fresh branch per
  run for isolation, runs the same checks, deletes the branch on exit.

Exit 0 on pass, non-zero on failure. No interactive input.
"""

from __future__ import annotations

import operator
import os
import time
from typing import Annotated, TypedDict

from dotenv import load_dotenv
from langgraph.graph import END, START, StateGraph
from persql import PerSQL

from langgraph.checkpoint.persql import PerSQLSaver

load_dotenv()

TOKEN = os.environ.get("PERSQL_TOKEN")
DATABASE = os.environ.get("PERSQL_DATABASE")
RUN_ID = os.environ.get("GITHUB_RUN_ID") or str(int(time.time()))

mode = "remote" if TOKEN else "local"
print(f"[ci] mode={mode}")


class State(TypedDict):
    total: Annotated[int, operator.add]


def build_graph(checkpointer: PerSQLSaver):
    builder = StateGraph(State)
    builder.add_node("add_one", lambda state: {"total": 1})
    builder.add_edge(START, "add_one")
    builder.add_edge("add_one", END)
    return builder.compile(checkpointer=checkpointer)


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
        config = {"configurable": {"thread_id": "t1"}}

        # 1. A real graph runs through the saver; state accumulates across
        #    separate invocations on the same thread.
        graph = build_graph(PerSQLSaver(db))
        first = graph.invoke({"total": 0}, config)
        assert first["total"] == 1, first
        second = graph.invoke({"total": 0}, config)
        assert second["total"] == 2, second
        print("[ci] state persisted across invocations")

        # 2. A fresh checkpointer over the same database resumes the state —
        #    survives a process restart, not just an in-memory cache.
        resumed = build_graph(PerSQLSaver(db))
        snapshot = resumed.get_state(config)
        assert snapshot.values["total"] == 2, snapshot.values
        print("[ci] state recovered by a fresh checkpointer")

        # 3. Threads are isolated — a new thread starts from zero.
        other = graph.invoke({"total": 0}, {"configurable": {"thread_id": "t2"}})
        assert other["total"] == 1, other
        print("[ci] threads isolated")

        print(f"[ci] PASS ({mode})")
    finally:
        if cleanup:
            cleanup()


if __name__ == "__main__":
    main()
