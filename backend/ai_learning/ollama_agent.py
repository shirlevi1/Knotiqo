
import json
import math
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

skill_instructions = SKILL_PATH.read_text(encoding="utf-8")

TOOLS = {
    "calculate_venue_cost": calculate_venue_cost,
    "calculate_remaining_budget": calculate_remaining_budget,
}


# ----------------------------------
# Helpers
# ----------------------------------

def clean_response(text: str | None) -> str:
    """Remove Qwen reasoning tags from the displayed answer."""
    if not text:
        return ""

    text = re.sub(
        r"<think>.*?</think>",
        "",
        text,
        flags=re.DOTALL,
    )

    if "<think>" in text:
        text = text.split("<think>", 1)[0]

    return text.strip()


def validate_number(value, name: str) -> float:
    """Accept only finite, non-negative numeric values."""
    if type(value) not in (int, float):
        raise ValueError(f"{name} must be numeric")

    if not math.isfinite(value) or not 0 <= value <= 1e12:
        raise ValueError(f"Invalid value for {name}")

    return value


def format_ils(amount: float) -> str:
    return f"{amount:,.0f} ₪"


def build_verified_summary(results: dict) -> str:
    """Build a reliable summary from Python calculations."""
    venue_cost = results.get("calculate_venue_cost")
    remaining = results.get("calculate_remaining_budget")

    if venue_cost is None or remaining is None:
        raise RuntimeError("Budget calculations are incomplete")

    status = (
        f"חריגה של {format_ils(abs(remaining))}"
        if remaining < 0
        else f"יתרה של {format_ils(remaining)}"
    )

    return (
        f"עלות המנות: {format_ils(venue_cost)}\n"
        f"יתרת התקציב: {format_ils(remaining)}\n"
        f"סטטוס: {status}"
    )


# ----------------------------------
# Tool Execution
# ----------------------------------

def execute_tool(tool_call, results: dict) -> dict:
    """Execute approved tools and reuse verified results."""

    tool_name = tool_call.function.name
    arguments = tool_call.function.arguments

    if tool_name not in TOOLS:
        raise ValueError(f"Unknown tool: {tool_name}")

    if not isinstance(arguments, dict):
        raise ValueError("Invalid tool arguments")

    # This prototype analyzes one wedding scenario.
    # Each calculation is performed once.
    if tool_name in results:
        result = results[tool_name]
        print(f"Cached tool: {tool_name}")

    elif tool_name == "calculate_venue_cost":
        guests = validate_number(
            arguments["guests"], "guests"
        )
        price = validate_number(
            arguments["price_per_guest"], "price_per_guest"
        )

        if not isinstance(guests, int):
            raise ValueError("guests must be an integer")

        result = calculate_venue_cost(
            guests=guests,
            price_per_guest=price,
        )

        results[tool_name] = result

    elif tool_name == "calculate_remaining_budget":
        if "calculate_venue_cost" not in results:
            return {
                "role": "tool",
                "tool_name": tool_name,
                "content": json.dumps({
                    "error": (
                        "Calculate venue cost first using "
                        "calculate_venue_cost"
                    )
                }),
            }

        total_budget = validate_number(
            arguments["total_budget"], "total_budget"
        )
        other_expenses = validate_number(
            arguments["other_expenses"], "other_expenses"
        )

        # Never trust the venue_cost supplied by the model.
        verified_venue_cost = results["calculate_venue_cost"]

        result = calculate_remaining_budget(
            total_budget=total_budget,
            venue_cost=verified_venue_cost,
            other_expenses=other_expenses,
        )

        results[tool_name] = result

    print(f"Tool: {tool_name}")
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
    """Run the wedding budget analysis skill."""

    messages = [
        {
            "role": "system",
            "content": (
                "You are Knotiqo's wedding budget assistant.\n"
                "Always respond in fluent Hebrew.\n"
                "Use the available tools for calculations.\n"
                "Do not invent prices or numerical results.\n"
                "Do not ask for information already provided.\n"
                "Use the verified tool results in your answer.\n"
                "Do not output internal reasoning.\n"
                "Give a concise analysis and practical advice.\n\n"
                f"Follow this skill:\n{skill_instructions}"
            ),
        },
        {
            "role": "user",
            "content": user_question,
        },
    ]

    # Verified calculations for this single scenario
    results = {}

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

        # Model has finished requesting tools
        if not calls:
            answer = clean_response(response.message.content)

            if len(results) == len(TOOLS):
                summary = build_verified_summary(results)

                if answer:
                    return (
                        f"{summary}\n\n"
                        f"הסבר הסוכן:\n{answer}"
                    )

                return summary

            if answer:
                return answer

            raise RuntimeError("Model returned an empty response")

        # Handle venue calculations first, because
        # budget calculation depends on venue cost.
        ordered_calls = sorted(
            calls,
            key=lambda call: (
                0 if call.function.name == "calculate_venue_cost"
                else 1
            ),
        )

        new_calculations = 0

        for call in ordered_calls:
            tool_name = call.function.name

            if tool_name not in results:
                new_calculations += 1

            tool_result = execute_tool(call, results)
            messages.append(tool_result)

        # Stop repeated requests for already computed tools.
        if new_calculations == 0 and len(results) == len(TOOLS):
            print("Repeated tool calls detected. Stopping.")
            return build_verified_summary(results)

    # If the model does not finish, preserve verified results.
    if len(results) == len(TOOLS):
        print("Maximum rounds reached. Using verified results.")
        return build_verified_summary(results)

    raise RuntimeError("Agent stopped before completing calculations")


# ----------------------------------
# Run
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
        print("\nAI:\n", answer)

    except Exception as error:
        print(f"\nAgent error: {error}")
