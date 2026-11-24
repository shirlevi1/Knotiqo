from django.urls import path

from .views import change_password_view, csrf_view, login_view, logout_view, me_view, register_view, update_profile_view

urlpatterns = [
    path("csrf/", csrf_view, name="csrf"),
    path("login/", login_view, name="login"),
    path("logout/", logout_view, name="logout"),
    path("me/", me_view, name="me"),
    path("profile/", update_profile_view, name="update-profile"),
    path("change-password/", change_password_view, name="change-password"),
    path("register/", register_view, name="register"),
]
