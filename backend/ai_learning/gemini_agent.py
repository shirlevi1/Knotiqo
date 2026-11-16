
import math
import os
import time
from pathlib import Path

from google import genai
from google.genai import types

from venue_tools import (
    calculate_venue_cost,
    calculate_remaining_budget,
)


# Configuration
MODEL = "gemini-3.5-flash-lite"

SKILL_PATH = (
        Path(__file__).resolve().parent
        / "skills"
        / "wedding_budget_analysis"
        / "SKILL.md"
)

skill_instructions = SKILL_PATH.read_text(
    encoding="utf-8"
)


def validate_amount(value: float, name: str) -> None:
    """Validate a non-negative financial amount."""
    if type(value) not in (int, float):
        raise ValueError(f"{name} must be numeric")

    if not math.isfinite(value) or not 0 <= value <= 1e12:
        raise ValueError(f"Invalid {name}")


def run_agent(question: str) -> dict:
    """Analyze a wedding budget using Gemini and Python tools."""

    if not question or not question.strip():
        raise ValueError("Question cannot be empty")

    if not os.getenv("GEMINI_API_KEY"):
        raise RuntimeError("GEMINI_API_KEY is missing")

    # Each agent execution has its own result.
    verified_result = None

    def analyze_wedding_budget(
            total_budget: float,
            guests: int,
            price_per_guest: float,
            other_expenses: float,
    ) -> dict:
        """Calculate the wedding budget using verified Python functions.

        Args:
            total_budget: Total wedding budget in ILS.
            guests: Number of wedding guests.
            price_per_guest: Meal cost per guest in ILS.
            other_expenses: Additional wedding expenses in ILS.
        """
        nonlocal verified_result

        if type(guests) is not int or guests <= 0:
            raise ValueError("Guests must be a positive integer")

        validate_amount(total_budget, "total_budget")
        validate_amount(price_per_guest, "price_per_guest")
        validate_amount(other_expenses, "other_expenses")

        venue_cost = calculate_venue_cost(
            guests=guests,
            price_per_guest=price_per_guest,
        )

        remaining = calculate_remaining_budget(
            total_budget=total_budget,
            venue_cost=venue_cost,
            other_expenses=other_expenses,
        )

        verified_result = {
            "total_budget": total_budget,
            "guests": guests,
            "price_per_guest": price_per_guest,
            "venue_cost": venue_cost,
            "other_expenses": other_expenses,
            "total_expenses": venue_cost + other_expenses,
            "remaining_budget": remaining,
            "over_budget": remaining < 0,
        }

        print("Tool executed: analyze_wedding_budget")
        print("Verified result:", verified_result)

        return verified_result

    client = genai.Client()

    config = types.GenerateContentConfig(
        system_instruction=(
            "You are Knotiqo's wedding budget assistant.\n"
            "Always respond in fluent Hebrew.\n"
            "Use analyze_wedding_budget for calculations.\n"
            "Never invent missing costs or numerical results.\n"
            "Use verified tool results.\n"
            "Give a concise analysis and practical advice.\n\n"
            f"{skill_instructions}"
        ),
        tools=[analyze_wedding_budget],
        temperature=0,
        automatic_function_calling=(
            types.AutomaticFunctionCallingConfig(
                maximum_remote_calls=3,
            )
        ),
    )

    start = time.perf_counter()

    # Use Chat for automatic function calling.
    chat_session = client.chats.create(
        model=MODEL,
        config=config,
    )

    response = chat_session.send_message(question)

    elapsed = time.perf_counter() - start

    print(f"\nExecution time: {elapsed:.2f} seconds")

    if verified_result is None:
        raise RuntimeError(
            "Gemini did not execute the budget tool"
        )

    answer = response.text

    if not answer or not answer.strip():
        raise RuntimeError("Gemini returned an empty answer")

    return {
        "answer": answer.strip(),
        "budget_analysis": verified_result,
        "execution_seconds": round(elapsed, 2),
    }


if __name__ == "__main__":
    question = (
        "אנחנו מתכננים חתונה עם תקציב של 120000 ש״ח. "
        "יש לנו 300 אורחים ומחיר מנה הוא 350 ש״ח. "
        "בנוסף יש הוצאות של 25000 ש״ח. "
        "תנתח את התקציב ותציע המלצה."
    )

    try:
        result = run_agent(question)

        print("\nGemini AI:")
        print(result["answer"])

        print("\nVerified budget analysis:")
        print(result["budget_analysis"])

    except Exception as error:
        print(f"Agent error: {error}")
