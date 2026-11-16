def calculate_venue_cost(
        guests: int,
        price_per_guest: float
) -> float:
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
    if total_budget < 0 or venue_cost < 0 or other_expenses < 0:
        raise ValueError("Amounts cannot be negative")

    return total_budget - venue_cost - other_expenses

