
from django.db import models
from django.core.validators import MinValueValidator
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
from django.db import models

# Create your models here.
