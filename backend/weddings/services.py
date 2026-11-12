from django.core.exceptions import PermissionDenied
from django.db import transaction
from .models import Wedding, WeddingMembership,WeddingInvitation
import secrets
import hashlib
from datetime import timedelta

from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.utils import timezone

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

@transaction.atomic
def create_partner_invitation(*, wedding, invited_by, email):
    # 1. Check authentication and permissions
    _require_authenticated_user(invited_by)

    # Lock the wedding to serialize invitation creation
    Wedding.objects.select_for_update().get(pk=wedding.pk)

    if not WeddingMembership.objects.filter(
            wedding=wedding,
            user=invited_by,
    ).exists():
        raise PermissionDenied(
            "You are not a member of this wedding."
        )

    # 2. Validate and normalize email
    if not isinstance(email, str):
        raise ValidationError("Invalid email address.")

    email = email.strip().lower()
    validate_email(email)

    # 3. Prevent inviting existing members
    if WeddingMembership.objects.filter(
            wedding=wedding,
            user__email__iexact=email,
    ).exists():
        raise ValidationError(
            "This user is already a wedding member."
        )

    # 4. Prevent duplicate active invitations
    now = timezone.now()

    if WeddingInvitation.objects.filter(
            wedding=wedding,
            invited_email__iexact=email,
            status=WeddingInvitation.InvitationStatus.PENDING,
            expires_at__gt=now,
    ).exists():
        raise ValidationError(
            "An active invitation already exists."
        )

    # 5. Generate a secure invitation token
    token = secrets.token_urlsafe(32)

    token_hash = hashlib.sha256(
        token.encode("utf-8")
    ).hexdigest()

    # 6. Set expiration date
    expires_at = now + timedelta(days=7)

    # 7. Save invitation
    invitation = WeddingInvitation.objects.create(
        wedding=wedding,
        invited_by=invited_by,
        invited_email=email,
        token_hash=token_hash,
        expires_at=expires_at,
        status=WeddingInvitation.InvitationStatus.PENDING,
    )

    return invitation, token
