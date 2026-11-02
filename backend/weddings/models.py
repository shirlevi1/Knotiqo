from django.conf import settings
from django.db import models


class Wedding(models.Model):
    name = models.CharField(max_length=150)
    wedding_date = models.DateField(null=True, blank=True)
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