"""Interactive LangGraph chat agent with state persisted in PerSQL.

Re-running with the same THREAD_ID replays the stored conversation, so the
agent remembers across process restarts.

    uv sync --extra interactive
    uv run python main.py
"""

from __future__ import annotations

import os

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from persql import PerSQL

from langgraph.checkpoint.persql import PerSQLSaver

load_dotenv()


def main() -> None:
    api_key = os.environ.get("OPENAI_API_KEY")
    token = os.environ.get("PERSQL_TOKEN")
    database = os.environ.get("PERSQL_DATABASE")
    if not (api_key and token and database):
        raise SystemExit("Set OPENAI_API_KEY, PERSQL_TOKEN, and PERSQL_DATABASE in .env")

    model = ChatOpenAI(
        model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
        api_key=api_key,
        # Optional OpenAI-compatible gateway. Unset -> the default OpenAI API.
        base_url=os.environ.get("OPENAI_BASE_URL") or None,
    )
    client = PerSQL(token=token)
    checkpointer = PerSQLSaver(client.database(database))
    agent = create_react_agent(model, tools=[], checkpointer=checkpointer)

    thread_id = os.environ.get("THREAD_ID", "session-1")
    config = {"configurable": {"thread_id": thread_id}}
    print(f'LangGraph agent ready (thread "{thread_id}"). Type a message or "exit".\n')

    while True:
        user_input = input("> ")
        if user_input.strip().lower() == "exit":
            break
        result = agent.invoke({"messages": [("user", user_input)]}, config)
        print(f"\n{result['messages'][-1].content}\n")


if __name__ == "__main__":
    main()
