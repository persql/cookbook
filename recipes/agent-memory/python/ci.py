"""Headless integration test for the agent-memory recipe.

Local mode  (default, no secrets): PerSQL(local=":memory:")
  — proves the SDK and MemoryStore API contract. No LLM call.

Remote mode (PERSQL_TOKEN + CF env vars set): hits real PerSQL + CF Workers AI.
  — proves end-to-end: SDK -> /v1 -> Durable Object + LLM turn.

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
CF_ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
CF_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN")

mode = "remote" if PERSQL_TOKEN else "local"
print(f"[ci] mode={mode}")

from persql import PerSQL
from main import MemoryStore, make_memory_tools  # type: ignore[import]


def make_store() -> MemoryStore:
    if PERSQL_TOKEN:
        return MemoryStore(token=PERSQL_TOKEN, database=PERSQL_DATABASE)

    class LocalMemoryStore(MemoryStore):
        def __init__(self) -> None:
            client = PerSQL(local=":memory:")
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

    # 3. Agent turn — answer from injected memory without a recall tool call.
    if not CF_ACCOUNT_ID or not CF_API_TOKEN:
        print("[ci] CF env vars not set — skipping agent turn")
    else:
        from openai import AsyncOpenAI
        from agents import Agent, Runner, set_default_openai_client

        set_default_openai_client(
            AsyncOpenAI(
                api_key=CF_API_TOKEN,
                base_url=f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/ai/v1",
            )
        )

        memories = store.index()
        mem_section = "\n\n".join(
            f"[{m['type']}] {m['name']}\n{m['description']}\n---\n{m['body']}"
            for m in memories
        )

        recall_called = False
        base_tools = make_memory_tools(store)

        # Wrap recall to detect if it was called (model should NOT call it).
        from agents.tool import FunctionTool  # type: ignore[import]
        wrapped_tools = []
        for t in base_tools:
            if getattr(t, "name", None) == "recall_memory":
                original = t.on_invoke_tool  # type: ignore[attr-defined]

                async def patched(ctx, inp, _orig=original):  # noqa: ANN001
                    nonlocal recall_called
                    recall_called = True
                    return await _orig(ctx, inp)

                try:
                    wrapped_tools.append(
                        FunctionTool(
                            name=t.name,
                            description=t.description,
                            params_json_schema=t.params_json_schema,
                            on_invoke_tool=patched,
                            strict_json_schema=getattr(t, "strict_json_schema", True),
                        )
                    )
                    continue
                except Exception:
                    pass
            wrapped_tools.append(t)

        agent = Agent(
            name="ci-agent",
            model="@cf/meta/llama-3.3-70b-instruct",
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
        assert not recall_called, "agent called recall_memory instead of answering from memory"
        print(f"[ci] agent turn ok — \"{output[:80]}...\"")

    # 4. Forget and confirm gone.
    store.forget("ci-test-fact")
    after = store.recall("widgets price")
    assert not after, "memory still returned after forget"
    print("[ci] forget ok")

    print(f"[ci] PASS ({mode})")


if __name__ == "__main__":
    asyncio.run(main())
