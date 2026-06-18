"""Interactive OpenAI Agents SDK chat with history persisted in PerSQL.

Re-running with the same SESSION_ID replays the stored turns to the model, so
the agent remembers across process restarts.

    uv run python main.py
"""

from __future__ import annotations

import asyncio
import os

from agents import Agent, OpenAIChatCompletionsModel, Runner, set_tracing_disabled
from dotenv import load_dotenv
from openai import AsyncOpenAI
from persql import PerSQL

from openai_agents_persql import PerSQLSession

load_dotenv()


async def main() -> None:
    api_key = os.environ.get("OPENAI_API_KEY")
    token = os.environ.get("PERSQL_TOKEN")
    database = os.environ.get("PERSQL_DATABASE")
    if not (api_key and token and database):
        raise SystemExit("Set OPENAI_API_KEY, PERSQL_TOKEN, and PERSQL_DATABASE in .env")

    # Optional OpenAI-compatible gateway. Unset -> the default OpenAI API.
    # Gateways speak /chat/completions, not /responses, and have no
    # platform.openai.com tracing.
    set_tracing_disabled(True)
    client = AsyncOpenAI(api_key=api_key, base_url=os.environ.get("OPENAI_BASE_URL") or None)
    model = OpenAIChatCompletionsModel(
        model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"), openai_client=client
    )

    persql = PerSQL(token=token)
    session_id = os.environ.get("SESSION_ID", "user-1")
    session = PerSQLSession(session_id, persql.database(database))
    agent = Agent(
        name="Assistant",
        model=model,
        instructions="You are a concise, helpful assistant. Use the conversation history.",
    )

    print(f'Agent ready (session "{session_id}"). Type a message or "exit".\n')
    while True:
        user_input = input("> ")
        if user_input.strip().lower() == "exit":
            break
        result = await Runner.run(agent, user_input, session=session)
        print(f"\n{result.final_output}\n")


if __name__ == "__main__":
    asyncio.run(main())
