"""Interactive Microsoft Agent Framework chat with history persisted in PerSQL.

Re-running with the same SESSION_ID replays the stored messages, so the agent
remembers across process restarts.

    uv sync --extra interactive
    uv run python main.py
"""

from __future__ import annotations

import asyncio
import os

from agent_framework.openai import OpenAIChatClient
from dotenv import load_dotenv
from persql import PerSQL

from agent_framework_persql import PerSQLHistoryProvider

load_dotenv()


async def main() -> None:
    api_key = os.environ.get("OPENAI_API_KEY")
    token = os.environ.get("PERSQL_TOKEN")
    database = os.environ.get("PERSQL_DATABASE")
    if not (api_key and token and database):
        raise SystemExit("Set OPENAI_API_KEY, PERSQL_TOKEN, and PERSQL_DATABASE in .env")

    # Optional OpenAI-compatible gateway. Unset -> the default OpenAI API.
    chat_client = OpenAIChatClient(
        model_id=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
        api_key=api_key,
        base_url=os.environ.get("OPENAI_BASE_URL") or None,
    )

    persql = PerSQL(token=token)
    provider = PerSQLHistoryProvider(persql.database(database))
    agent = chat_client.as_agent(
        instructions="You are a concise, helpful assistant.",
        context_providers=[provider],
    )

    session_id = os.environ.get("SESSION_ID", "user-1")
    session = agent.create_session(session_id=session_id)
    print(f'Agent ready (session "{session_id}"). Type a message or "exit".\n')

    while True:
        user_input = input("> ")
        if user_input.strip().lower() == "exit":
            break
        result = await agent.run(user_input, session=session)
        print(f"\n{result.text}\n")


if __name__ == "__main__":
    asyncio.run(main())
