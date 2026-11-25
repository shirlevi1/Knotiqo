from django.contrib import admin
from django.urls import include, path
from config.views import health_check
from weddings.rsvp import public_rsvp
from weddings.urls import invitation_urlpatterns

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/rsvp/", public_rsvp, name="public-rsvp"),
    path("api/health/", health_check, name="health-check"),
    path("api/weddings/", include("weddings.urls")),
    path("api/weddings/", include("venues.urls")),
    path("api/wedding-invitations/", include(invitation_urlpatterns)),
    path("api/auth/", include("accounts.urls")),
    path("api/ai/", include("ai_assistant.urls")),
]
