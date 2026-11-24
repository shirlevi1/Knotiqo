from rest_framework import serializers
from .covers import cover_url
from .models import Wedding


class CoupleNameField(serializers.CharField):
    def to_internal_value(self, data):
        if not isinstance(data, str):
            self.fail("invalid")
        value = super().to_internal_value(data)
        if not value.isprintable():
            self.fail("invalid")
        return value


class CoupleNamesSerializer(serializers.ModelSerializer):
    creator_display_name = CoupleNameField(max_length=80)
    partner_display_name = CoupleNameField(max_length=80)

    class Meta:
        model = Wedding
        fields = ["creator_display_name", "partner_display_name"]

    def to_internal_value(self, data):
        writable_fields = {name for name, field in self.fields.items() if not field.read_only}
        if isinstance(data, dict) and set(data) - writable_fields:
            raise serializers.ValidationError({"non_field_errors": ["Unexpected fields."]})
        return super().to_internal_value(data)


class WeddingSerializer(CoupleNamesSerializer):
    cover_image_url = serializers.SerializerMethodField()

    class Meta(CoupleNamesSerializer.Meta):
        fields = ["id", "name", "wedding_date", "cover_image_url", *CoupleNamesSerializer.Meta.fields]
        read_only_fields = ["id"]

    def get_cover_image_url(self, wedding):
        return cover_url(wedding)

    def to_internal_value(self, data):
        if isinstance(data, dict):
            # DRF CharField normally coerces numbers to strings. Require JSON strings.
            if "name" in data and not isinstance(data["name"], str):
                raise serializers.ValidationError({"name": ["Must be a string."]})
            date = data.get("wedding_date")
            if date is not None and not isinstance(date, str):
                raise serializers.ValidationError({
                    "wedding_date": ["Must be an ISO date string or null."],
                })
        return super().to_internal_value(data)


class WeddingMemberSerializer(serializers.Serializer):
    display_name = serializers.SerializerMethodField()
    first_name = serializers.SerializerMethodField()

    def get_first_name(self, membership):
        return membership.user.first_name.strip() or None

    def get_display_name(self, membership):
        user = membership.user
        username = user.get_username()
        return user.get_full_name() or (username if "@" not in username else None)


class WeddingDetailsSerializer(WeddingSerializer):
    memberships = WeddingMemberSerializer(many=True, read_only=True)

    class Meta(WeddingSerializer.Meta):
        fields = [*WeddingSerializer.Meta.fields, "memberships"]
        read_only_fields = fields


class CreateInvitationSerializer(serializers.Serializer):
    email = serializers.EmailField()


class InvitationTokenSerializer(serializers.Serializer):
    token = serializers.RegexField(r"\A[A-Za-z0-9_-]{43}\Z", trim_whitespace=False)

    def to_internal_value(self, data):
        if not isinstance(data, dict) or set(data) != {"token"} or not isinstance(data["token"], str):
            raise serializers.ValidationError({
                "non_field_errors": ["Only an invitation token is accepted."],
            })
        return super().to_internal_value(data)
