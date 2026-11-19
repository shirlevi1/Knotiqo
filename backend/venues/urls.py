from django.urls import path

from .views import VenueDetail, VenueList, VenueQuoteDetail, VenueQuoteList


urlpatterns = [
    path("<int:wedding_id>/venues/", VenueList.as_view(), name="venue-list"),
    path("<int:wedding_id>/venues/<int:venue_id>/", VenueDetail.as_view(), name="venue-detail"),
    path("<int:wedding_id>/venues/<int:venue_id>/quotes/", VenueQuoteList.as_view(), name="venue-quote-list"),
    path("<int:wedding_id>/venues/<int:venue_id>/quotes/<int:quote_id>/", VenueQuoteDetail.as_view(), name="venue-quote-detail"),
]
