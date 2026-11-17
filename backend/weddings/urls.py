from django.urls import path
from .views import accept_invitation, create_invitation, my_weddings, validate_invitation, wedding_couple_names, wedding_details

invitation_urlpatterns = [
    path("validate/", validate_invitation, name="validate-invitation"),
    path("accept/", accept_invitation, name="accept-invitation"),
]

urlpatterns = [
    path("", my_weddings, name="my-weddings"),
    path("<int:wedding_id>/", wedding_details, name="wedding-details"),
    path("<int:wedding_id>/couple-names/", wedding_couple_names, name="wedding-couple-names"),
    path(
        "<int:wedding_id>/invitations/",
        create_invitation,
        name="create-invitation",
    ),
]
