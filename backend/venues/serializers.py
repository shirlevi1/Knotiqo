

from rest_framework import serializers

from .models import Venue, VenueQuote


class ScopedResourceSerializer(serializers.ModelSerializer):
    def to_internal_value(self, data):
        if isinstance(data, dict):
            writable = {name for name, field in self.fields.items() if not field.read_only}
            if set(data) - writable:
                raise serializers.ValidationError({
                    "non_field_errors": ["Only editable resource fields are accepted."],
                })
        return super().to_internal_value(data)


class VenueSerializer(ScopedResourceSerializer):

    class Meta:
        model = Venue

        fields = [
            "id",
            "name",
            "location",
            "contact_name",
            "phone",
            "website",
            "capacity",
            "notes",
            "status",
            "is_favorite",
            "created_at",
            "updated_at",
        ]

        read_only_fields = [
            "id",
            "created_at",
            "updated_at",
        ]


class VenueQuoteSerializer(ScopedResourceSerializer):
    class Meta:
        model = VenueQuote
        fields = [
            "id", "event_date", "price_per_guest", "minimum_guests",
            "additional_costs", "notes", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]
