from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.http import Http404
from rest_framework.authentication import SessionAuthentication
from rest_framework.generics import GenericAPIView, ListCreateAPIView, RetrieveUpdateDestroyAPIView
from rest_framework.permissions import IsAuthenticated

from .serializers import VenueQuoteSerializer, VenueSerializer
from .services import quotes_for_user, venues_for_user


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
