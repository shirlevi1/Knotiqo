from django.core.exceptions import PermissionDenied
from django.db import transaction

from .models import Wedding, WeddingMembership


def _require_authenticated_user(user):
    if not user.is_authenticated or not user.is_active:
        raise PermissionDenied("An active authenticated user is required.")


def weddings_for_user(*, user):
    """Return only weddings belonging to the acting user."""
    _require_authenticated_user(user)
    return Wedding.objects.filter(members=user).order_by("id")


@transaction.atomic
def create_wedding(*, user, name, wedding_date=None):
    """Create a wedding and its first membership from validated input."""
    _require_authenticated_user(user)
    wedding = Wedding.objects.create(name=name, wedding_date=wedding_date)
    WeddingMembership.objects.create(wedding=wedding, user=user)
    return wedding
