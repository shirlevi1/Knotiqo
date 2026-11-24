from django.conf import settings
from django.db import models
from django.db.models.functions import Cast
from uuid import uuid4


class Wedding(models.Model):
    name = models.CharField(max_length=150)
    creator_display_name = models.CharField(max_length=80, blank=True, default="")
    partner_display_name = models.CharField(max_length=80, blank=True, default="")
    wedding_date = models.DateField(null=True, blank=True)
    cover_image = models.ImageField(upload_to="wedding-covers/", blank=True, db_default="")
    created_at = models.DateTimeField(auto_now_add=True)

    members = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        through="WeddingMembership",
        related_name="weddings",
    )

    def __str__(self):
        return self.name


GUEST_AGE_FIELDS = ("adult_count", "child_count", "infant_count")


class Guest(models.Model):
    class Side(models.TextChoices):
        BRIDE = "bride", "Bride"
        GROOM = "groom", "Groom"
        JOINT = "joint", "Joint"
        UNASSIGNED = "unassigned", "Unassigned"

    class Category(models.TextChoices):
        ADULT = "adult", "Adult"
        CHILD = "child", "Child"
        INFANT = "infant", "Infant"

    wedding = models.ForeignKey(Wedding, on_delete=models.CASCADE, related_name="guests")
    full_name = models.CharField(max_length=150)
    phone = models.CharField(max_length=32, blank=True)
    email = models.EmailField(blank=True)
    side = models.CharField(max_length=10, choices=Side.choices, default=Side.UNASSIGNED)
    category = models.CharField(max_length=6, choices=Category.choices, default=Category.ADULT)
    family_group = models.CharField(max_length=150, blank=True)
    tags = models.JSONField(default=list, blank=True)
    party_size = models.PositiveIntegerField(default=1)
    adult_count = models.PositiveIntegerField(null=True, blank=True)
    child_count = models.PositiveIntegerField(null=True, blank=True)
    infant_count = models.PositiveIntegerField(null=True, blank=True)
    notes = models.TextField(blank=True, max_length=4000)
    is_archived = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.CheckConstraint(condition=models.Q(party_size__gte=1), name="guest_positive_party_size"),
            models.CheckConstraint(
                condition=models.Q(adult_count__isnull=True, child_count__isnull=True, infant_count__isnull=True)
                | models.Q(adult_count__isnull=False, child_count__isnull=False, infant_count__isnull=False,
                           party_size=Cast("adult_count", models.BigIntegerField())
                           + models.F("child_count") + models.F("infant_count")),
                name="guest_age_counts_match_party_size",
            ),
        ]
        indexes = [
            models.Index(fields=["wedding", "is_archived", "id"], name="guest_wedding_archive_id"),
        ]


class GuestImportSession(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    wedding = models.ForeignKey(Wedding, on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    expires_at = models.DateTimeField(db_index=True)
    sheets = models.JSONField(default=list)
    preview = models.JSONField(default=dict)
    confirmation_hash = models.CharField(max_length=64, blank=True)
    result = models.JSONField(default=dict)

    class Meta:
        indexes = [models.Index(fields=["wedding", "expires_at"], name="guest_import_wedding_expiry")]


class WeddingMembership(models.Model):
    wedding = models.ForeignKey(
        Wedding,
        on_delete=models.CASCADE,
        related_name="memberships",
    )

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="wedding_memberships",
    )

    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["wedding", "user"],
                name="unique_wedding_member",
            )
        ]


class WeddingInvitation(models.Model):

    class InvitationStatus(models.TextChoices):
        PENDING = "pending", "Pending"
        ACCEPTED = "accepted", "Accepted"
        REVOKED = "revoked", "Revoked"

    wedding = models.ForeignKey(
        Wedding,
        on_delete=models.CASCADE,
        related_name="invitations",
    )

    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="sent_invitations",
    )

    invited_email = models.EmailField()

    token_hash = models.CharField(
        max_length=64,
        unique=True,
    )

    status = models.CharField(
        max_length=20,
        choices=InvitationStatus.choices,
        default=InvitationStatus.PENDING,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    expires_at = models.DateTimeField()

    accepted_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    def __str__(self):
        return f"{self.invited_email} - {self.wedding.name} ({self.status})"


