import re

from django.db.models import Count, Q, Sum
from django.db import transaction
from django.http import Http404
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from rest_framework import serializers
from rest_framework.authentication import SessionAuthentication
from rest_framework.generics import GenericAPIView, ListCreateAPIView, RetrieveUpdateDestroyAPIView
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated

from .models import GUEST_AGE_FIELDS, Guest
from .services import weddings_for_user


MAX_PARTY_SIZE = 2**31 - 1


class GuestSerializer(serializers.ModelSerializer):
    tags = serializers.ListField(child=serializers.CharField(max_length=40), max_length=20, required=False)
    party_size = serializers.IntegerField(min_value=1, max_value=MAX_PARTY_SIZE, required=False)
    unnamed_companions = serializers.SerializerMethodField()
    unclassified_count = serializers.SerializerMethodField()

    class Meta:
        model = Guest
        fields = [
            "id", "full_name", "phone", "email", "side", "category", "family_group", "tags",
            "party_size", *GUEST_AGE_FIELDS, "unclassified_count", "unnamed_companions",
            "notes", "is_archived", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]
        extra_kwargs = {field: {"min_value": 0, "max_value": MAX_PARTY_SIZE} for field in GUEST_AGE_FIELDS}

    def to_internal_value(self, data):
        writable = {field.field_name for field in self.fields.values() if not field.read_only}
        if isinstance(data, dict) and set(data) - writable:
            raise serializers.ValidationError({"non_field_errors": ["Unexpected guest fields."]})
        return super().to_internal_value(data)

    def get_unnamed_companions(self, guest):
        return guest.party_size - 1

    def get_unclassified_count(self, guest):
        return guest.party_size if guest.adult_count is None else 0

    def validate(self, attrs):
        provided = [field for field in GUEST_AGE_FIELDS if field in attrs]
        if provided:
            if len(provided) != len(GUEST_AGE_FIELDS) or any(attrs[field] is None for field in provided):
                raise serializers.ValidationError({"adult_count": "Provide all three age counts."})
            total = sum(attrs[field] for field in GUEST_AGE_FIELDS)
            if not 1 <= total <= MAX_PARTY_SIZE:
                raise serializers.ValidationError({"party_size": "Age counts must sum to a positive supported total."})
            if attrs.get("party_size", total) != total:
                raise serializers.ValidationError({"party_size": "Total must equal the sum of the age counts."})
            attrs["party_size"] = total
        elif self.instance and self.instance.adult_count is not None and (
            attrs.get("party_size", self.instance.party_size) != self.instance.party_size
        ):
            raise serializers.ValidationError({"party_size": "Provide age counts to change this total."},
                                              code="guest_age_conflict")
        return attrs

    def validate_phone(self, phone):
        if phone and (not re.fullmatch(r"\+?[0-9 ().-]+", phone)
                or not 5 <= sum(char.isdigit() for char in phone) <= 15):
            raise serializers.ValidationError("Enter a valid phone number.")
        return phone

    def validate_tags(self, tags):
        return list(dict.fromkeys(tags))

    def update(self, instance, validated_data):
        if validated_data:
            for field, value in validated_data.items():
                setattr(instance, field, value)
            instance.save(update_fields=[*validated_data, "updated_at"])
        return instance


class GuestFilters(serializers.Serializer):
    search = serializers.CharField(max_length=150, allow_blank=True, required=False)
    side = serializers.ChoiceField(choices=Guest.Side.choices, required=False)
    category = serializers.ChoiceField(choices=Guest.Category.choices, required=False)
    archive = serializers.ChoiceField(choices=["active", "archived", "all"], default="active")


class GuestPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 100


@method_decorator(never_cache, name="dispatch")
class WeddingGuestView(GenericAPIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]
    serializer_class = GuestSerializer

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        self.wedding_id = kwargs["wedding_id"]
        if not weddings_for_user(user=request.user).filter(pk=self.wedding_id).exists():
            raise Http404()

    def handle_exception(self, exc):
        return super().handle_exception(Http404() if isinstance(exc, Http404) else exc)

    def get_queryset(self):
        return Guest.objects.filter(wedding_id=self.wedding_id)


class GuestList(WeddingGuestView, ListCreateAPIView):
    pagination_class = GuestPagination

    def list(self, request, *args, **kwargs):
        filters = GuestFilters(data=request.query_params)
        filters.is_valid(raise_exception=True)
        search = filters.validated_data.get("search")
        archive = filters.validated_data["archive"]
        guests = self.get_queryset()
        if archive != "all":
            guests = guests.filter(is_archived=archive == "archived")
        if search:
            guests = guests.filter(Q(full_name__icontains=search) | Q(phone__icontains=search))
        if side := filters.validated_data.get("side"):
            guests = guests.filter(side=side)
        if category := filters.validated_data.get("category"):
            guests = guests.filter(
                Q(adult_count__isnull=True, category=category) | Q(**{f"{category}_count__gt": 0}),
            )

        page = self.paginate_queryset(guests)
        response = self.get_paginated_response(self.get_serializer(page, many=True).data)
        summary = guests.order_by().aggregate(
            records=Count("pk"), attendees=Sum("party_size", default=0),
            unclassified_count=Sum("party_size", filter=Q(adult_count__isnull=True), default=0),
            **{field: Sum(field, default=0) for field in GUEST_AGE_FIELDS},
            **{side: Sum("party_size", filter=Q(side=side), default=0) for side in Guest.Side.values},
        )
        summary["unnamed_companions"] = summary["attendees"] - summary["records"]
        response.data["summary"] = summary
        return response

    def perform_create(self, serializer):
        serializer.save(wedding_id=self.wedding_id)


class GuestDetail(WeddingGuestView, RetrieveUpdateDestroyAPIView):
    lookup_url_kwarg = "guest_id"
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_queryset(self):
        guests = super().get_queryset()
        return guests.select_for_update() if self.request.method == "PATCH" else guests

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        return super().update(request, *args, **kwargs)

    def perform_destroy(self, instance):
        if not instance.is_archived:
            instance.is_archived = True
            instance.save(update_fields=["is_archived", "updated_at"])
