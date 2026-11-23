
from django.conf import settings
from django.db import models
from django.core.validators import MinValueValidator, URLValidator
from weddings.models import Wedding


class Venue(models.Model):

    class Status(models.TextChoices):
        INTERESTED = "interested", "Interested"
        MEETING_SCHEDULED = "meeting_scheduled", "Meeting scheduled"
        QUOTE_RECEIVED = "quote_received", "Quote received"
        BOOKED = "booked", "Booked"
        REJECTED = "rejected", "Rejected"

    wedding = models.ForeignKey(
        Wedding,
        on_delete=models.CASCADE,
        related_name="venues",
    )

    name = models.CharField(max_length=150)
    description = models.TextField(blank=True, default="")

    location = models.CharField(
        max_length=150,
        blank=True,
    )

    contact_name = models.CharField(
        max_length=100,
        blank=True,
    )

    phone = models.CharField(
        max_length=25,
        blank=True,
    )

    website = models.URLField(
        max_length=500,
        blank=True,
    )

    capacity = models.PositiveIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(1)],
    )

    notes = models.TextField(blank=True)

    status = models.CharField(
        max_length=30,
        choices=Status.choices,
        default=Status.INTERESTED,
    )

    is_favorite = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)

    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(capacity__isnull=True) | models.Q(capacity__gte=1),
                name="venue_positive_capacity",
            ),
        ]

class VenueQuote(models.Model):

    venue = models.ForeignKey(
        Venue,
        on_delete=models.CASCADE,
        related_name="quotes",
    )

    event_date = models.DateField(
        null=True,
        blank=True,
    )

    price_per_guest = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(0)],
    )

    minimum_guests = models.PositiveIntegerField(
        validators=[MinValueValidator(1)],
    )

    additional_costs = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
        validators=[MinValueValidator(0)],
    )

    notes = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.venue.name} - {self.price_per_guest} ILS"

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(price_per_guest__gte=0), name="quote_nonnegative_price"),
            models.CheckConstraint(condition=models.Q(additional_costs__gte=0), name="quote_nonnegative_costs"),
            models.CheckConstraint(condition=models.Q(minimum_guests__gte=1), name="quote_positive_minimum_guests"),
        ]
class VenueImage(models.Model):
    venue = models.ForeignKey(Venue, on_delete=models.CASCADE, related_name="images")
    image_url = models.URLField(
        max_length=500, validators=[URLValidator(schemes=["http", "https"])],
    )
    source_url = models.URLField(
        max_length=500, blank=True, default="",
        validators=[URLValidator(schemes=["http", "https"])],
    )
    alt_text = models.CharField(max_length=255, blank=True, default="")
    is_primary = models.BooleanField(default=False)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-is_primary", "sort_order", "id"]
        constraints = [
            models.UniqueConstraint(fields=["venue", "image_url"], name="unique_venue_image_url"),
            models.UniqueConstraint(
                fields=["venue"], condition=models.Q(is_primary=True),
                name="unique_primary_venue_image",
            ),
            models.CheckConstraint(
                condition=models.Q(image_url__iregex=r"^https?://"),
                name="venue_image_http_url",
            ),
            models.CheckConstraint(
                condition=models.Q(source_url="") | models.Q(source_url__iregex=r"^https?://"),
                name="venue_image_http_source",
            ),
        ]


class VenueImagePreview(models.Model):
    token_hash = models.CharField(max_length=64, unique=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    wedding = models.ForeignKey(Wedding, on_delete=models.CASCADE)
    venue = models.ForeignKey(Venue, on_delete=models.CASCADE)
    website = models.CharField(max_length=4096)
    saved_website = models.CharField(max_length=500, blank=True)
    candidates = models.JSONField(default=dict)
    used_image_urls = models.JSONField(default=list)
    expires_at = models.DateTimeField(db_index=True)


class VenuePreviewRateWindow(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    window_start = models.DateTimeField(db_index=True)
    request_count = models.PositiveSmallIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "window_start"], name="venue_preview_user_window"),
        ]
