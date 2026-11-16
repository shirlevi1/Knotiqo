def calculate_venue_cost(guests: int, price_per_guest: float) -> float:
    """Calculate the total venue meal cost.

    Args:
        guests: Number of wedding guests.
        price_per_guest: Meal price in ILS per guest.
    """
    if guests <= 0:
        raise ValueError("Guest count must be positive")
    if price_per_guest < 0:
        raise ValueError("Price cannot be negative")

    return guests * price_per_guest


def calculate_remaining_budget(
        total_budget: float,
        venue_cost: float,
        other_expenses: float
) -> float:
    """Calculate money remaining after wedding expenses.

    Args:
        total_budget: Total available wedding budget in ILS.
        venue_cost: Total venue cost in ILS.
        other_expenses: All additional wedding expenses in ILS.
    """
    if min(total_budget, venue_cost, other_expenses) < 0:
        raise ValueError("Amounts cannot be negative")

    return total_budget - venue_cost - other_expenses