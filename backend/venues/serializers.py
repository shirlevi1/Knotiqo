

from django.core.validators import URLValidator
from rest_framework import serializers

from .models import Venue, VenueImage, VenueQuote


class EditableFieldsMixin:
    def to_internal_value(self, data):
        if isinstance(data, dict):
            writable = {name for name, field in self.fields.items() if not field.read_only}
            if set(data) - writable:
                raise serializers.ValidationError({
                    "non_field_errors": ["Only editable resource fields are accepted."],
                })
        return super().to_internal_value(data)


class ScopedResourceSerializer(EditableFieldsMixin, serializers.ModelSerializer):
    pass


class VenueMetadataPreviewSerializer(EditableFieldsMixin, serializers.Serializer):
    website = serializers.CharField(required=False, max_length=4096, trim_whitespace=False)


http_url = URLValidator(schemes=["http", "https"])


class VenueImageSelectionSerializer(EditableFieldsMixin, serializers.Serializer):
    image_url = serializers.CharField(max_length=500, trim_whitespace=False, validators=[http_url])
    source_url = serializers.CharField(
        required=False, allow_blank=True, max_length=500, trim_whitespace=False, validators=[http_url],
    )
    alt_text = serializers.CharField(required=False, max_length=255, allow_blank=True)


class SaveVenueImagesSerializer(EditableFieldsMixin, serializers.Serializer):
    preview_token = serializers.RegexField(r"\A[A-Za-z0-9_-]{43}\Z", max_length=43, trim_whitespace=False)
    images = VenueImageSelectionSerializer(many=True, allow_empty=False, max_length=20)


class VenueImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = VenueImage
        fields = ["id", "image_url", "source_url", "alt_text", "is_primary", "sort_order", "created_at"]
        read_only_fields = fields


class VenueSerializer(ScopedResourceSerializer):
    images = VenueImageSerializer(many=True, read_only=True)

    class Meta:
        model = Venue

        fields = [
            "id",
            "name",
            "description",
            "images",
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
            "images",
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
