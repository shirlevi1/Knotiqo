from django.http import Http404

from weddings.services import weddings_for_user

from .models import Venue, VenueQuote


def venues_for_user(*, user, wedding_id):
    if not weddings_for_user(user=user).filter(pk=wedding_id).exists():
        raise Http404
    return Venue.objects.filter(wedding_id=wedding_id).order_by("id")


def quotes_for_user(*, user, wedding_id, venue_id):
    if not venues_for_user(user=user, wedding_id=wedding_id).filter(pk=venue_id).exists():
        raise Http404
    return VenueQuote.objects.filter(venue_id=venue_id, venue__wedding_id=wedding_id).order_by("id")
