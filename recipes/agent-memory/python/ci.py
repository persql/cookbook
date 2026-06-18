"""Headless integration test for the agent-memory recipe.

Local mode  (default, no secrets): PerSQL(local=":memory:")
  — proves the SDK and MemoryStore API contract.

Remote mode (PERSQL_TOKEN set): hits a real PerSQL database.
  — proves end-to-end: SDK -> /v1 -> Durable Object.

Exit 0 on pass, non-zero on failure. No interactive input.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys

from dotenv import load_dotenv

load_dotenv()

PERSQL_TOKEN = os.environ.get("PERSQL_TOKEN")
PERSQL_DATABASE = os.environ.get("PERSQL_DATABASE", "ci/agent-memory")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")

mode = "remote" if PERSQL_TOKEN else "local"
print(f"[ci] mode={mode}")


# Import here so the local-mode path doesn't need remote deps installed.
from persql import PerSQL
from main import MemoryStore, make_memory_tools  # type: ignore[import]


def make_store() -> MemoryStore:
    if PERSQL_TOKEN:
        return MemoryStore(token=PERSQL_TOKEN, database=PERSQL_DATABASE)
    # Local mode: PerSQL in-process SQLite, no network.
    from persql import PerSQL as _P

    class LocalMemoryStore(MemoryStore):
        def __init__(self) -> None:
            client = _P(local=":memory:")
            self._client = client
            self._db = client.database("test/ci")
            self._ready = False

    return LocalMemoryStore()


async def main() -> None:
    store = make_store()
    store.init()

    # 1. Save a known memory.
    store.remember(
        name="ci-test-fact",
        description="Widget table schema for CI",
        body="The widgets table has: id INTEGER PRIMARY KEY, name TEXT, price REAL.",
        type="project",
    )
    print("[ci] memory saved")

    # 2. Verify round-trip via recall.
    hits = store.recall("widgets price")
    assert hits, "recall returned no results"
    assert "price REAL" in hits[0]["body"], f"unexpected body: {hits[0]['body']}"
    print("[ci] recall ok")

    # 3. Agent turn — should answer from injected memory without a recall tool call.
    if not OPENAI_API_KEY:
        print("[ci] OPENAI_API_KEY not set — skipping agent turn")
    else:
        from agents import Agent, Runner

        memories = store.index()
        mem_section = "\n\n".join(
            f"[{m['type']}] {m['name']}\n{m['description']}\n---\n{m['body']}"
            for m in memories
        )

        recall_called = False
        base_tools = make_memory_tools(store)

        # Wrap recall to track whether it was called.
        from agents.tool import FunctionTool  # type: ignore[import]
        wrapped_tools = []
        for t in base_tools:
            if hasattr(t, "name") and t.name == "recall_memory":
                original_fn = t.on_invoke_tool  # type: ignore[attr-defined]

                async def patched(ctx, input, _orig=original_fn):  # noqa: ANN001
                    nonlocal recall_called
                    recall_called = True
                    return await _orig(ctx, input)

                # Rebuild with patched handler — fall back gracefully if API differs.
                try:
                    wrapped = FunctionTool(
                        name=t.name,
                        description=t.description,
                        params_json_schema=t.params_json_schema,
                        on_invoke_tool=patched,
                        strict_json_schema=getattr(t, "strict_json_schema", True),
                    )
                    wrapped_tools.append(wrapped)
                except Exception:
                    wrapped_tools.append(t)
            else:
                wrapped_tools.append(t)

        agent = Agent(
            name="ci-agent",
            model="gpt-4o-mini",
            instructions=(
                "You are a helpful assistant.\n\n"
                f"MEMORIES:\n{mem_section}\n\n"
                "Answer questions covered above directly without calling any tool first."
            ),
            tools=wrapped_tools,
        )

        result = await Runner.run(agent, "What columns does the widgets table have?")
        output = result.final_output or ""
        assert output, "agent returned empty output"
        assert "price" in output.lower(), f"response did not mention price: {output}"
        assert not recall_called, "agent called recall_memory instead of answering from injected memory"
        print(f"[ci] agent turn ok — \"{output[:80]}...\"")

    # 4. Forget and confirm gone.
    store.forget("ci-test-fact")
    after = store.recall("widgets price")
    assert not after, "memory still returned after forget"
    print("[ci] forget ok")

    print(f"[ci] PASS ({mode})")


if __name__ == "__main__":
    asyncio.run(main())
