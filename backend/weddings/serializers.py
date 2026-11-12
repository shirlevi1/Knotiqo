from rest_framework import serializers
from .models import Wedding


class WeddingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Wedding
        fields = ["id", "name", "wedding_date"]
        read_only_fields = ["id"]

    def to_internal_value(self, data):
        if isinstance(data, dict):
            if set(data) - {"name", "wedding_date"}:
                raise serializers.ValidationError({
                    "non_field_errors": ["Only name and wedding_date are accepted."],
                })
            # DRF CharField normally coerces numbers to strings. Require JSON strings.
            if "name" in data and not isinstance(data["name"], str):
                raise serializers.ValidationError({"name": ["Must be a string."]})
            date = data.get("wedding_date")
            if date is not None and not isinstance(date, str):
                raise serializers.ValidationError({
                    "wedding_date": ["Must be an ISO date string or null."],
                })
        return super().to_internal_value(data)


class CreateInvitationSerializer(serializers.Serializer):
    email = serializers.EmailField()