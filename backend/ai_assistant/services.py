import json
import os
from decimal import Decimal, localcontext
from pathlib import Path


SKILL_PATH = (
    Path(__file__).resolve().parents[1]
    / "ai_learning" / "skills" / "wedding_budget_analysis" / "SKILL.md"
)
MODEL = "gemini-3.5-flash-lite"
DEFAULT_TIMEOUT_SECONDS = 30


class BudgetProviderUnavailable(Exception):
    pass


def calculate_budget(
    *,
    total_budget: Decimal,
    guests: int,
    price_per_guest: Decimal,
    other_expenses: Decimal,
) -> dict[str, str | int | bool]:
    """Calculate with validated inputs and serialize money as exact decimal strings."""
    guest_count = Decimal(guests)
    with localcontext() as context:
        # Allow for the price's digits, the guest count, and a carry from addition.
        context.prec = len(guest_count.as_tuple().digits) + 13
        venue_cost = price_per_guest * guest_count
        total_expenses = venue_cost + other_expenses
        remaining_budget = total_budget - total_expenses

    return {
        "total_budget": format(total_budget, ".2f"),
        "guests": guests,
        "price_per_guest": format(price_per_guest, ".2f"),
        "venue_cost": format(venue_cost, ".2f"),
        "other_expenses": format(other_expenses, ".2f"),
        "total_expenses": format(total_expenses, ".2f"),
        "remaining_budget": format(remaining_budget, ".2f"),
        "over_budget": remaining_budget < 0,
    }


def explain_budget(breakdown: dict[str, str | int | bool]) -> str:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise BudgetProviderUnavailable

    try:
        timeout_seconds = int(os.getenv("GEMINI_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS)))
    except ValueError:
        raise BudgetProviderUnavailable from None
    if timeout_seconds <= 0:
        raise BudgetProviderUnavailable

    try:
        from google import genai
        from google.genai import types

        instructions = SKILL_PATH.read_text(encoding="utf-8")
        with genai.Client(
            api_key=api_key,
            vertexai=False,
            http_options=types.HttpOptions(
                timeout=timeout_seconds * 1000,
                retry_options=types.HttpRetryOptions(attempts=1),
            ),
        ) as client:
            response = client.models.generate_content(
                model=MODEL,
                contents="Verified budget breakdown (ILS):\n" + json.dumps(breakdown),
                config=types.GenerateContentConfig(
                    system_instruction=instructions,
                    automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
                    max_output_tokens=400,
                ),
            )
            recommendation = (response.text or "").strip()
    except Exception:
        # Provider failures can include credentials or request and response details.
        raise BudgetProviderUnavailable from None

    if not recommendation:
        raise BudgetProviderUnavailable
    return recommendation


def analyze_wedding_budget(validated_data):
    breakdown = calculate_budget(**validated_data)
    return {
        "budget_analysis": breakdown,
        "ai_recommendation": explain_budget(breakdown),
    }
