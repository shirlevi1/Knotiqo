from django.contrib import admin
from django.urls import include, path
from config.views import health_check
from weddings.urls import invitation_urlpatterns

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health_check, name="health-check"),
    path("api/weddings/", include("weddings.urls")),
    path("api/wedding-invitations/", include(invitation_urlpatterns)),
    path("api/auth/", include("accounts.urls")),
]
