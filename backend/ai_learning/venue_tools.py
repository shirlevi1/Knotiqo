def calculate_venue_cost(
        guests: int,
        price_per_guest: float
) -> float:
    if guests <= 0:
        raise ValueError("Guest count must be positive")

    if price_per_guest < 0:
        raise ValueError("Price cannot be negative")

    return guests * price_per_guest

if __name__ == "__main__":
    print(calculate_venue_cost(250, 350))
