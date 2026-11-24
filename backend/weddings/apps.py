from django.apps import AppConfig


class WeddingsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'weddings'

    def ready(self):
        from . import covers  # noqa: F401
