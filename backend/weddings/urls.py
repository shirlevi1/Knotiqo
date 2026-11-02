from django.urls import path
from .views import my_weddings

urlpatterns = [
    path("", my_weddings, name="my-weddings"),
]