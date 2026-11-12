from django.urls import path
from .views import my_weddings, create_invitation

urlpatterns = [
    path("", my_weddings, name="my-weddings"),
    path(
        "<int:wedding_id>/invitations/",
        create_invitation,
        name="create-invitation",
    ),
]