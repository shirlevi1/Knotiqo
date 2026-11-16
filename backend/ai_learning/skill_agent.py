
import json
import re
from pathlib import Path

from ollama import chat

from venue_tools import (
    calculate_venue_cost,
    calculate_remaining_budget,
)


# ----------------------------------
# Configuration
# ----------------------------------

MODEL = "qwen3:4b"
MAX_ROUNDS = 5

SKILL_PATH = (
        Path(__file__).resolve().parent
        / "skills"
        / "wedding_budget_analysis"
        / "SKILL.md"
)


# ----------------------------------
# Load skill instructions
# ----------------------------------

skill_instructions = SKILL_PATH.read_text(
    encoding="utf-8"
)


# ----------------------------------
# Available tools
# ----------------------------------

TOOLS = {
    "calculate_venue_cost": calculate_venue_cost,
    "calculate_remaining_budget": calculate_remaining_budget,
}


# ----------------------------------
# Helpers
# ----------------------------------

def clean_response(text: str | None) -> str:
    """Remove reasoning tags from displayed output."""
    if not text:
        return ""

    text = re.sub(
        r"<think>.*?</think>",
        "",
        text,
        flags=re.DOTALL,
    )

    # Do not display unfinished reasoning blocks.
    if "<think>" in text:
        text = text.split("<think>", 1)[0]

    return text.strip()


def execute_tool(tool_call) -> dict:
    """Execute a tool from the approved registry."""

    tool_name = tool_call.function.name
    function = TOOLS.get(tool_name)

    if function is None:
        raise ValueError(f"Unknown tool: {tool_name}")

    arguments = tool_call.function.arguments

    if not isinstance(arguments, dict):
        raise ValueError("Invalid tool arguments")

    for value in arguments.values():
        if type(value) not in (int, float):
            raise ValueError("Tool arguments must be numeric")

        if not -1e12 <= value <= 1e12:
            raise ValueError("Numeric argument is out of range")

    result = function(**arguments)

    print(f"Tool: {tool_name}")
    print(f"Arguments: {arguments}")
    print(f"Result: {result}")

    return {
        "role": "tool",
        "tool_name": tool_name,
        "content": json.dumps(result),
    }


# ----------------------------------
# Agent
# ----------------------------------

def run_agent(user_question: str) -> str:
    """Run the wedding budget agent."""

    messages = [
        {
            "role": "system",
            "content": (
                "You are Knotiqo's wedding budget assistant.\n"
                "Always answer in fluent Hebrew.\n"
                "Use tools for all numerical calculations.\n"
                "Do not ask for information already provided.\n"
                "Never invent prices or calculation results.\n"
                "After using tools, summarize the results clearly.\n\n"
                f"Follow this skill:\n{skill_instructions}"
            ),
        },
        {
            "role": "user",
            "content": user_question,
        },
    ]

    for round_number in range(MAX_ROUNDS):
        print(f"\nStarting round {round_number + 1}...")

        response = chat(
            model=MODEL,
            messages=messages,
            tools=list(TOOLS.values()),
            think=False,
        )

        messages.append(response.message)

        calls = response.message.tool_calls or []

        # The model is ready to answer.
        if not calls:
            answer = clean_response(response.message.content)

            if answer:
                return answer

            raise RuntimeError(
                "Model returned an empty final response"
            )

        # Execute requested tools.
        for call in calls:
            print(f"\nRound {round_number + 1}")
            tool_result = execute_tool(call)
            messages.append(tool_result)

    raise RuntimeError(
        f"Agent exceeded maximum of {MAX_ROUNDS} rounds"
    )


# ----------------------------------
# Entry point
# ----------------------------------

if __name__ == "__main__":
    question = (
        "אנחנו מתכננים חתונה עם תקציב של 120000 ש״ח. "
        "יש לנו 300 אורחים ומחיר מנה הוא 350 ש״ח. "
        "בנוסף יש לנו הוצאות של 25000 ש״ח. "
        "תנתח את התקציב שלנו ותציע המלצה."
    )

    try:
        answer = run_agent(question)
        print("\nAI:", answer)

    except Exception as error:
        print(f"\nAgent error: {error}")
