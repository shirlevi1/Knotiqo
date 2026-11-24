from django.conf import settings
from django.db import models


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


