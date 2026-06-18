"""Headless integration test for the agent-memory recipe.

Local mode  (default, no secrets): PerSQL(local=":memory:")
  — proves the SDK and MemoryStore API contract. No LLM call.

Remote mode (PERSQL_TOKEN + PERSQL_DATABASE set): claims a fresh branch
  per run for isolation, runs tests, deletes the branch on exit.
  With OPENAI_API_KEY also set: proves the full agent turn end-to-end.

Exit 0 on pass, non-zero on failure. No interactive input.
"""

from __future__ import annotations

import asyncio
import os
import time

from dotenv import load_dotenv

load_dotenv()

PERSQL_TOKEN = os.environ.get("PERSQL_TOKEN")
PERSQL_DATABASE = os.environ.get("PERSQL_DATABASE")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
RUN_ID = os.environ.get("GITHUB_RUN_ID") or str(int(time.time()))

mode = "remote" if PERSQL_TOKEN else "local"
print(f"[ci] mode={mode}")

from persql import PerSQL
from main import MemoryStore, make_memory_tools  # type: ignore[import]


async def main() -> None:
    cleanup = None

    if PERSQL_TOKEN and PERSQL_DATABASE:
        # Claim a fresh branch per run for isolation.
        parent = PerSQL(token=PERSQL_TOKEN)
        branch_ref = f"ci-{RUN_ID}"
        claimed = parent.database(PERSQL_DATABASE).branches.claim(
            ref=branch_ref, role="admin", ttl_sec=3600
        )
        persql = PerSQL(token=claimed["token"])
        db_path = f"{claimed['namespaceSlug']}/{claimed['databaseSlug']}"
        store = MemoryStore(token=claimed["token"], database=db_path)

        async def _cleanup() -> None:
            parent.database(PERSQL_DATABASE).branches.delete(branch_ref)
            print("[ci] branch cleaned up")

        cleanup = _cleanup
    else:
        client = PerSQL(local=":memory:")
        store = MemoryStore.__new__(MemoryStore)
        store._client = client  # type: ignore[attr-defined]
        store._db = client.database("test/ci")  # type: ignore[attr-defined]
        store._ready = False  # type: ignore[attr-defined]

    try:
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

        # 3. Agent turn — answer from injected memory without a recall tool call.
        if not OPENAI_API_KEY:
            print("[ci] OPENAI_API_KEY not set — skipping agent turn")
        else:
            from openai import AsyncOpenAI
            from agents import (
                Agent,
                OpenAIChatCompletionsModel,
                Runner,
                set_tracing_disabled,
            )

            openai_base_url = os.environ.get("OPENAI_BASE_URL") or None
            openai_model = os.environ.get("OPENAI_MODEL") or "gpt-4o-mini"

            # Custom gateway: speaks /chat/completions, not /responses, and has
            # no platform.openai.com tracing.
            set_tracing_disabled(True)
            client = AsyncOpenAI(api_key=OPENAI_API_KEY, base_url=openai_base_url)
            model = OpenAIChatCompletionsModel(model=openai_model, openai_client=client)

            memories = store.index()
            mem_section = "\n\n".join(
                f"[{m['type']}] {m['name']}\n{m['description']}\n---\n{m['body']}"
                for m in memories
            )

            agent = Agent(
                name="ci-agent",
                model=model,
                instructions=(
                    "You are a helpful assistant.\n\n"
                    f"MEMORIES:\n{mem_section}\n\n"
                    "Answer questions covered above directly without calling any tool first."
                ),
                tools=make_memory_tools(store),
            )

            result = await Runner.run(agent, "What columns does the widgets table have?")
            output = result.final_output or ""
            assert output, "agent returned empty output"
            assert "price" in output.lower(), f"response did not mention price: {output}"
            print(f"[ci] agent turn ok — \"{output[:80]}...\"")

        # 4. Forget and confirm gone.
        store.forget("ci-test-fact")
        after = store.recall("widgets price")
        assert not after, "memory still returned after forget"
        print("[ci] forget ok")

        print(f"[ci] PASS ({mode})")

    finally:
        if cleanup:
            await cleanup()


if __name__ == "__main__":
    asyncio.run(main())
