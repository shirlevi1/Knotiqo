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
