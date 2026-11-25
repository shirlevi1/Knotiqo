from datetime import UTC, datetime, time, timedelta
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from django.db import transaction
from django.db.models import Prefetch, Q
from django.db.models.functions import TruncDate
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils.timezone import now
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from rest_framework import serializers
from rest_framework.authentication import SessionAuthentication
from rest_framework.generics import ListCreateAPIView, RetrieveUpdateDestroyAPIView, GenericAPIView
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from venues.models import Venue, VenueImage
from venues.serializers import EditableFieldsMixin, JSONIntegerField

from .guests import GuestSerializer
from .models import WeddingMeeting, WeddingVendor
from .services import weddings_for_user


JERUSALEM = ZoneInfo("Asia/Jerusalem")


def local_instant(day, clock, field):
    wall = datetime.combine(day, clock)
    candidates = set()
    for fold in (0, 1):
        try:
            instant = wall.replace(tzinfo=JERUSALEM, fold=fold).astimezone(UTC)
            if instant.astimezone(JERUSALEM).replace(tzinfo=None) == wall:
                candidates.add(instant)
        except (OverflowError, ValueError):
            pass
    if len(candidates) != 1:
        raise serializers.ValidationError({field: ["This local time is ambiguous or unavailable. Choose another time."]},
                                          code="invalid_local_time")
    return candidates.pop()


class MeetingSerializer(EditableFieldsMixin, serializers.ModelSerializer):
    date = serializers.DateField(write_only=True)
    start_time = serializers.TimeField(input_formats=["%H:%M"], write_only=True)
    end_time = serializers.TimeField(input_formats=["%H:%M"], write_only=True, allow_null=True, required=False)
    venue_id = JSONIntegerField(min_value=1, max_value=2**63 - 1, allow_null=True, required=False)
    vendor_id = JSONIntegerField(min_value=1, max_value=2**63 - 1, allow_null=True, required=False)
    venue_name = serializers.CharField(source="venue.name", read_only=True, default=None)
    vendor_name = serializers.CharField(source="vendor.name", read_only=True, default=None)

    class Meta:
        model = WeddingMeeting
        fields = ("id", "title", "meeting_type", "date", "start_time", "end_time", "starts_at", "ends_at",
                  "contact_person", "phone", "location", "video_url", "notes", "status", "venue_id", "vendor_id",
                  "venue_name", "vendor_name")
        read_only_fields = ("id", "starts_at", "ends_at")

    def validate_phone(self, value):
        return GuestSerializer().validate_phone(value)

    def validate_video_url(self, value):
        if value:
            try:
                parsed = urlsplit(value)
                parsed.port
            except ValueError as error:
                raise serializers.ValidationError("Enter a valid video link.") from error
            if parsed.scheme not in ("http", "https") or parsed.username is not None or parsed.password is not None:
                raise serializers.ValidationError("Enter an HTTP or HTTPS link without credentials.")
        return value

    def validate(self, attrs):
        instance = self.instance
        venue = attrs.get("venue_id", instance.venue_id if instance else None)
        vendor = attrs.get("vendor_id", instance.vendor_id if instance else None)
        if venue is not None and vendor is not None:
            raise serializers.ValidationError({"venue_id": ["Choose at most one venue or vendor."]})
        wedding = self.context["view"].wedding
        for field, model in (("venue_id", Venue), ("vendor_id", WeddingVendor)):
            if attrs.get(field) is not None:
                get_object_or_404(model.objects.select_for_update(), wedding=wedding, pk=attrs[field])

        if instance is None or {"date", "start_time", "end_time"} & attrs.keys():
            start = instance.starts_at.astimezone(JERUSALEM) if instance else None
            end = instance.ends_at.astimezone(JERUSALEM) if instance and instance.ends_at else None
            day = attrs.pop("date", start.date() if start else None)
            if day.year < 1900:
                raise serializers.ValidationError({"date": ["Dates before 1900 are outside the supported range."]})
            start_clock = attrs.pop("start_time", start.time() if start else None)
            end_clock = attrs.pop("end_time", end.time() if end else None)
            attrs["starts_at"] = local_instant(day, start_clock, "start_time")
            attrs["ends_at"] = local_instant(day, end_clock, "end_time") if end_clock is not None else None
            if attrs["ends_at"] is not None and attrs["ends_at"] <= attrs["starts_at"]:
                raise serializers.ValidationError({"end_time": ["End time must be after start time on the same day."]})
        return attrs

    def to_representation(self, instance):
        values = super().to_representation(instance)
        start = instance.starts_at.astimezone(JERUSALEM)
        end = instance.ends_at.astimezone(JERUSALEM) if instance.ends_at else None
        venue, vendor = instance.venue, instance.vendor
        if venue:
            images = getattr(venue, "meeting_primary_images", None)
            image = venue.images.filter(is_primary=True).first() if images is None else next(iter(images), None)
            values["venue_details"] = {
                "location": venue.location, "contact_person": venue.contact_name, "phone": venue.phone,
                "image_url": image.image_url if image else None, "image_alt": image.alt_text if image else "",
            }
        if vendor:
            values["vendor_details"] = {
                "category": vendor.service_category, "contact_person": vendor.contact_person, "phone": vendor.phone,
            }
        return {**values, "date": start.date().isoformat(), "start_time": start.strftime("%H:%M"),
                "end_time": end.strftime("%H:%M") if end else None}


class MeetingFilters(serializers.Serializer):
    upcoming = serializers.BooleanField(required=False)
    association = serializers.ChoiceField(choices=["venue", "vendor", "general"], required=False)
    search = serializers.CharField(required=False, max_length=150)
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)
    venue_id = serializers.IntegerField(min_value=1, max_value=2**63 - 1, required=False)
    vendor_id = serializers.IntegerField(min_value=1, max_value=2**63 - 1, required=False)
    meeting_type = serializers.ChoiceField(choices=WeddingMeeting.Type, required=False)
    status = serializers.ChoiceField(choices=WeddingMeeting.Status, required=False)

    def validate(self, attrs):
        start, end = attrs.get("date_from"), attrs.get("date_to")
        if start and start.year < 1900 or end and end.year < 1900:
            raise serializers.ValidationError({"date_from": ["Dates before 1900 are outside the supported range."]})
        if start and end and end < start:
            raise serializers.ValidationError({"date_to": ["End date must be on or after start date."]})
        if end and end.year == 9999 and end.month == 12 and end.day == 31:
            raise serializers.ValidationError({"date_to": ["End date is outside the supported range."]})
        return attrs


class MeetingPagination(PageNumberPagination):
    page_size = 100


@method_decorator(never_cache, name="dispatch")
class WeddingMeetingView(GenericAPIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]
    serializer_class = MeetingSerializer

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        self.wedding = get_object_or_404(weddings_for_user(user=request.user), pk=kwargs["wedding_id"])

    def handle_exception(self, exc):
        return super().handle_exception(Http404() if isinstance(exc, Http404) else exc)

    def get_queryset(self):
        return self.wedding.meetings.select_related("venue", "vendor").prefetch_related(
            Prefetch("venue__images", queryset=VenueImage.objects.filter(is_primary=True),
                     to_attr="meeting_primary_images"),
        )


class MeetingRangeView(WeddingMeetingView):
    def get_queryset(self):
        query = super().get_queryset()
        filters = MeetingFilters(data=self.request.query_params)
        filters.is_valid(raise_exception=True)
        values = filters.validated_data
        start = values.pop("date_from", None)
        end = values.pop("date_to", None)
        if start:
            query = query.filter(starts_at__gte=datetime.combine(start, time.min, tzinfo=JERUSALEM))
        if end:
            query = query.filter(starts_at__lt=datetime.combine(end + timedelta(days=1), time.min, tzinfo=JERUSALEM))
        if values.pop("upcoming", False):
            query = query.filter(starts_at__gte=now(), status=WeddingMeeting.Status.SCHEDULED)
        association = values.pop("association", None)
        if association == "general":
            query = query.filter(venue__isnull=True, vendor__isnull=True)
        elif association:
            query = query.filter(**{f"{association}__isnull": False})
        if search := values.pop("search", None):
            query = query.filter(Q(title__icontains=search) | Q(venue__name__icontains=search) | Q(vendor__name__icontains=search))
        return query.filter(**values)

class MeetingDates(MeetingRangeView):
    def get(self, request, *args, **kwargs):
        limits = MeetingFilters(data=request.query_params)
        limits.is_valid(raise_exception=True)
        start, end = (limits.validated_data.get(field) for field in ("date_from", "date_to"))
        if not start or not end or (end - start).days > 366:
            raise serializers.ValidationError({"date_to": ["Choose a date range of up to 367 days."]})
        days = self.get_queryset().annotate(day=TruncDate("starts_at", tzinfo=JERUSALEM))
        return Response(list(days.order_by("day").values_list("day", flat=True).distinct()))


class MeetingList(MeetingRangeView, ListCreateAPIView):
    pagination_class = MeetingPagination

    def list(self, request, *args, **kwargs):
        if request.query_params.get("summary") == "1":
            query = self.get_queryset()
            first = query.first()
            return Response({"count": query.count(), "first": self.get_serializer(first).data if first else None})
        return super().list(request, *args, **kwargs)

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        serializer.save(wedding=self.wedding)


class MeetingDetail(WeddingMeetingView, RetrieveUpdateDestroyAPIView):
    lookup_url_kwarg = "meeting_id"
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_queryset(self):
        query = super().get_queryset()
        return query.select_for_update(of=("self",)) if self.request.method == "PATCH" else query

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        return super().update(request, *args, **kwargs)


class UpcomingMeetings(WeddingMeetingView):
    def get(self, request, *args, **kwargs):
        scope = request.query_params.get("scope", "dashboard")
        query = self.get_queryset().filter(status=WeddingMeeting.Status.SCHEDULED, starts_at__gte=now())
        if scope == "dashboard":
            meetings = query[:5]
        elif scope in {"venues", "vendors"}:
            field = "venue_id" if scope == "venues" else "vendor_id"
            meetings = query.filter(**{f"{field}__isnull": False}).order_by(field, "starts_at", "pk").distinct(field)
        else:
            raise serializers.ValidationError({"scope": ["Invalid upcoming meeting scope."]})
        return Response(self.get_serializer(meetings, many=True).data)

class MeetingOptions(WeddingMeetingView):
    def get(self, request, *args, **kwargs):
        resources = [
            {"kind": kind, "id": record["pk"], "name": record["name"], **({"location": record["location"]} if kind == "venue" else {})}
            for kind, model in (("venue", Venue), ("vendor", WeddingVendor))
            for record in model.objects.filter(wedding=self.wedding).order_by("name", "pk").values(
                "pk", "name", *(("location",) if kind == "venue" else ()),
            )
        ]
        return Response(resources)
