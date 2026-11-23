from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models.functions import Now

from venues.models import VenueImagePreview, VenuePreviewRateWindow


class Command(BaseCommand):
    help = "Delete expired venue previews and rate windows older than one hour."

    def handle(self, *args, **options):
        previews, _ = VenueImagePreview.objects.filter(expires_at__lte=Now()).delete()
        windows, _ = VenuePreviewRateWindow.objects.filter(
            window_start__lt=Now() - timedelta(hours=1),
        ).delete()
        self.stdout.write(f"Deleted {previews} expired previews and {windows} obsolete rate windows.")
