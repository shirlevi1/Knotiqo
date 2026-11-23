from decimal import Context, Decimal, localcontext

from django.http import Http404

from weddings.services import weddings_for_user

from .models import Venue, VenueImage, VenueQuote


def venues_for_user(*, user, wedding_id):
    if not weddings_for_user(user=user).filter(pk=wedding_id).exists():
        raise Http404
    return Venue.objects.filter(wedding_id=wedding_id).prefetch_related("images").order_by("id")


def quotes_for_user(*, user, wedding_id, venue_id):
    if not venues_for_user(user=user, wedding_id=wedding_id).filter(pk=venue_id).exists():
        raise Http404
    return VenueQuote.objects.filter(venue_id=venue_id, venue__wedding_id=wedding_id).order_by("id")


def compare_quotes_for_user(*, user, wedding_id, expected_guests, quote_ids):
    """Compare validated selections in the wedding using the saved quote inputs."""
    quotes = list(VenueQuote.objects.filter(
        pk__in=quote_ids, venue__wedding__in=weddings_for_user(user=user).filter(pk=wedding_id),
    ).select_related("venue"))
    if len(quotes) != len(quote_ids):
        raise Http404()

    # Minimum commitments fit in ten digits. Prices have ten digits, and
    # adding a twelve-digit amount to the product can carry one more digit.
    guest_digits = max(10, len(Decimal(expected_guests).as_tuple().digits))
    with localcontext(Context(prec=guest_digits + 11)):
        priced = []
        for quote in quotes:
            billable_guests = max(expected_guests, quote.minimum_guests)
            meals_cost = quote.price_per_guest * billable_guests
            total_cost = meals_cost + quote.additional_costs
            priced.append((total_cost, quote.pk, quote, billable_guests, meals_cost))
        priced.sort(key=lambda entry: (entry[0], entry[1]))
        cheapest_total, cheapest_id, *_ = priced[0]
        comparisons = [
            {
                "quote_id": quote_id,
                "venue_id": quote.venue_id,
                "venue_name": quote.venue.name,
                "event_date": quote.event_date.isoformat() if quote.event_date else None,
                "minimum_guests": quote.minimum_guests,
                "price_per_guest": format(quote.price_per_guest, ".2f"),
                "additional_costs": format(quote.additional_costs, ".2f"),
                "notes": quote.notes,
                "billable_guests": billable_guests,
                "meals_cost": format(meals_cost, ".2f"),
                "total_cost": format(total_cost, ".2f"),
                "difference_from_cheapest": format(total_cost - cheapest_total, ".2f"),
            }
            for total_cost, quote_id, quote, billable_guests, meals_cost in priced
        ]

    return {
        "expected_guests": expected_guests,
        "comparisons": comparisons,
        "cheapest_quote_id": cheapest_id,
        "cheapest_quote_label": "Lowest known calculated cost",
    }


def append_images(venue, selected):
    """Append verified selections while the caller holds a lock on the venue."""
    existing = list(venue.images.all())
    urls = {image.image_url for image in existing}
    start = max((image.sort_order for image in existing), default=-1) + 1
    new_images = []
    for image in selected:
        if image["image_url"] not in urls:
            new_images.append(VenueImage(
                venue=venue, **image, sort_order=start + len(new_images),
                is_primary=not existing and not new_images,
            ))
    VenueImage.objects.bulk_create(new_images)
    return existing + new_images
