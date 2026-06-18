"""Interactive AWS Strands agent with session state persisted in PerSQL.

Re-running with the same SESSION_ID resumes the stored messages and agent
state, so the agent remembers across process restarts.

    uv sync --extra interactive
    uv run python main.py
"""

from __future__ import annotations

import os

from dotenv import load_dotenv
from persql import PerSQL
from strands import Agent
from strands.models.openai import OpenAIModel

from strands_persql import PerSQLSessionManager

load_dotenv()


def main() -> None:
    api_key = os.environ.get("OPENAI_API_KEY")
    token = os.environ.get("PERSQL_TOKEN")
    database = os.environ.get("PERSQL_DATABASE")
    if not (api_key and token and database):
        raise SystemExit("Set OPENAI_API_KEY, PERSQL_TOKEN, and PERSQL_DATABASE in .env")

    # Optional OpenAI-compatible gateway. Unset -> the default OpenAI API.
    client_args: dict[str, object] = {"api_key": api_key}
    base_url = os.environ.get("OPENAI_BASE_URL")
    if base_url:
        client_args["base_url"] = base_url
    model = OpenAIModel(
        client_args=client_args,
        model_id=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
    )

    persql = PerSQL(token=token)
    session_id = os.environ.get("SESSION_ID", "user-1")
    manager = PerSQLSessionManager(session_id, persql.database(database))
    agent = Agent(model=model, session_manager=manager)

    print(f'Strands agent ready (session "{session_id}"). Type a message or "exit".\n')
    while True:
        user_input = input("> ")
        if user_input.strip().lower() == "exit":
            break
        # The agent streams its reply to stdout as it generates.
        agent(user_input)
        print()


if __name__ == "__main__":
    main()
