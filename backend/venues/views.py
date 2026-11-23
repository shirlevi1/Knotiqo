from io import BytesIO

from django.db import DatabaseError, IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.http import Http404
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import ParseError
from rest_framework.generics import GenericAPIView, ListCreateAPIView, RetrieveUpdateDestroyAPIView
from rest_framework.parsers import JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .image_previews import PreviewError, consume_selection, create_preview, unavailable
from .serializers import (
    SaveVenueImagesSerializer, VenueComparisonSerializer, VenueImageSerializer, VenueMetadataPreviewSerializer,
    VenueQuoteSerializer, VenueSerializer,
)
from .services import append_images, compare_quotes_for_user, quotes_for_user, venues_for_user


@method_decorator(never_cache, name="dispatch")
class WeddingResourceView(GenericAPIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def handle_exception(self, exc):
        if isinstance(exc, Http404):
            exc = Http404()
        return super().handle_exception(exc)

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        # Authorize the nested parent before parsing or validating write payloads.
        self.get_queryset()


class VenueView(WeddingResourceView):
    serializer_class = VenueSerializer

    def get_queryset(self):
        return venues_for_user(user=self.request.user, wedding_id=self.kwargs["wedding_id"])


class VenueList(VenueView, ListCreateAPIView):
    def perform_create(self, serializer):
        self.get_queryset()
        serializer.save(wedding_id=self.kwargs["wedding_id"])


class VenueDetail(VenueView, RetrieveUpdateDestroyAPIView):
    lookup_url_kwarg = "venue_id"
    http_method_names = ["get", "patch", "delete", "head", "options"]


class VenueComparisonJSONParser(JSONParser):
    def parse(self, stream, media_type=None, parser_context=None):
        limit = 4096
        body = stream.read(limit + 1)
        if len(body) > limit:
            raise ParseError("Comparison requests must be 4 KiB or smaller.")
        try:
            return super().parse(BytesIO(body), media_type, parser_context)
        except RecursionError as error:
            raise ParseError("Invalid JSON request.") from error


class VenueComparison(VenueView):
    serializer_class = VenueComparisonSerializer
    parser_classes = [VenueComparisonJSONParser]
    http_method_names = ["post", "options"]

    def post(self, request, wedding_id):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(compare_quotes_for_user(
            user=request.user, wedding_id=wedding_id, **serializer.validated_data,
        ))


class VenueMediaJSONParser(JSONParser):
    def parse(self, stream, media_type=None, parser_context=None):
        max_bytes = 96 * 1024
        body = stream.read(max_bytes + 1)
        if len(body) > max_bytes:
            raise PreviewError("request_too_large", "The JSON request exceeds the size limit.", 413)
        try:
            return super().parse(BytesIO(body), media_type, parser_context)
        except RecursionError as error:
            raise ParseError("Invalid JSON request.") from error


class VenueMediaView(VenueView):
    lookup_url_kwarg = "venue_id"
    parser_classes = [VenueMediaJSONParser]

    def handle_exception(self, exc):
        if isinstance(exc, DatabaseError):
            exc = unavailable()
        if isinstance(exc, PreviewError):
            headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after is not None else None
            response = Response(
                {"error": {"code": exc.code, "message": str(exc)}},
                status=exc.status_code, headers=headers,
            )
            response.exception = True
            return response
        return super().handle_exception(exc)

    def get_queryset(self):
        return super().get_queryset().prefetch_related(None)

    def lock_venue(self):
        queryset = self.get_queryset().select_for_update()
        return get_object_or_404(queryset, pk=self.kwargs["venue_id"])


class VenueMetadataPreview(VenueMediaView):
    serializer_class = VenueMetadataPreviewSerializer
    http_method_names = ["post", "options"]

    def post(self, request, **kwargs):
        venue = self.get_object()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(create_preview(
            user_id=request.user.pk, venue=venue,
            website=serializer.validated_data.get("website", venue.website),
        ))


class VenueImageList(VenueMediaView):
    serializer_class = SaveVenueImagesSerializer
    http_method_names = ["post", "options"]

    def post(self, request, **kwargs):
        self.get_object()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                locked_venue = self.lock_venue()
                selected = consume_selection(
                    user_id=request.user.pk, venue=locked_venue, token=serializer.validated_data["preview_token"],
                    images=serializer.validated_data["images"],
                )
                images = append_images(locked_venue, selected)
        except IntegrityError as error:
            raise PreviewError("image_conflict", "The venue images changed. Try again.", 409) from error
        return Response({"images": VenueImageSerializer(images, many=True).data})


class VenueImageDetail(VenueMediaView):
    serializer_class = VenueImageSerializer
    http_method_names = ["delete", "options"]

    def delete(self, request, image_id, **kwargs):
        with transaction.atomic():
            venue = self.lock_venue()
            get_object_or_404(venue.images.all(), pk=image_id).delete()
        return Response(status=204)


class VenueQuoteView(WeddingResourceView):
    serializer_class = VenueQuoteSerializer

    def get_queryset(self):
        return quotes_for_user(
            user=self.request.user,
            wedding_id=self.kwargs["wedding_id"],
            venue_id=self.kwargs["venue_id"],
        )


class VenueQuoteList(VenueQuoteView, ListCreateAPIView):
    def perform_create(self, serializer):
        self.get_queryset()
        serializer.save(venue_id=self.kwargs["venue_id"])


class VenueQuoteDetail(VenueQuoteView, RetrieveUpdateDestroyAPIView):
    lookup_url_kwarg = "quote_id"
    http_method_names = ["get", "patch", "delete", "head", "options"]
