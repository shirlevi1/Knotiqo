from django.urls import path

from .views import (
    VenueComparison, VenueDetail, VenueImageDetail, VenueImageList, VenueList, VenueMetadataPreview,
    VenueQuoteDetail, VenueQuoteList,
)


urlpatterns = [
    path("<int:wedding_id>/venues/", VenueList.as_view(), name="venue-list"),
    path("<int:wedding_id>/venues/compare/", VenueComparison.as_view(), name="venue-compare"),
    path("<int:wedding_id>/venues/<int:venue_id>/", VenueDetail.as_view(), name="venue-detail"),
    path("<int:wedding_id>/venues/<int:venue_id>/metadata-preview/", VenueMetadataPreview.as_view(), name="venue-metadata-preview"),
    path("<int:wedding_id>/venues/<int:venue_id>/images/", VenueImageList.as_view(), name="venue-image-list"),
    path("<int:wedding_id>/venues/<int:venue_id>/images/<int:image_id>/", VenueImageDetail.as_view(), name="venue-image-detail"),
    path("<int:wedding_id>/venues/<int:venue_id>/quotes/", VenueQuoteList.as_view(), name="venue-quote-list"),
    path("<int:wedding_id>/venues/<int:venue_id>/quotes/<int:quote_id>/", VenueQuoteDetail.as_view(), name="venue-quote-detail"),
]
