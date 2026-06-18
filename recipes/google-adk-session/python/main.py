"""Interactive Google ADK agent with sessions persisted in PerSQL.

Re-running with the same SESSION_ID resumes the stored events and state, so the
agent remembers across process restarts.

    uv sync --extra interactive
    uv run python main.py
"""

from __future__ import annotations

import asyncio
import os

from dotenv import load_dotenv
from google.adk.agents import Agent
from google.adk.models.lite_llm import LiteLlm
from google.adk.runners import Runner
from google.genai import types
from persql import PerSQL

from google_adk_persql import PerSQLSessionService

load_dotenv()


async def main() -> None:
    api_key = os.environ.get("OPENAI_API_KEY")
    token = os.environ.get("PERSQL_TOKEN")
    database = os.environ.get("PERSQL_DATABASE")
    if not (api_key and token and database):
        raise SystemExit("Set OPENAI_API_KEY, PERSQL_TOKEN, and PERSQL_DATABASE in .env")

    # ADK reaches a custom OpenAI-compatible gateway through LiteLlm. Unset
    # OPENAI_BASE_URL -> the default OpenAI API.
    model = LiteLlm(
        model="openai/" + os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
        api_key=api_key,
        api_base=os.environ.get("OPENAI_BASE_URL") or None,
    )
    agent = Agent(
        name="assistant", model=model, instruction="You are a concise, helpful assistant."
    )

    persql = PerSQL(token=token)
    service = PerSQLSessionService(persql.database(database))
    app_name, user_id = "cookbook", "user-1"
    session_id = os.environ.get("SESSION_ID", "session-1")

    # Reuse the session across restarts; create it once.
    existing = await service.get_session(
        app_name=app_name, user_id=user_id, session_id=session_id
    )
    if existing is None:
        await service.create_session(
            app_name=app_name, user_id=user_id, session_id=session_id
        )

    runner = Runner(agent=agent, app_name=app_name, session_service=service)
    print(f'ADK agent ready (session "{session_id}"). Type a message or "exit".\n')

    while True:
        user_input = input("> ")
        if user_input.strip().lower() == "exit":
            break
        message = types.Content(role="user", parts=[types.Part(text=user_input)])
        async for event in runner.run_async(
            user_id=user_id, session_id=session_id, new_message=message
        ):
            if event.is_final_response() and event.content:
                print(f"\n{event.content.parts[0].text}\n")


if __name__ == "__main__":
    asyncio.run(main())
