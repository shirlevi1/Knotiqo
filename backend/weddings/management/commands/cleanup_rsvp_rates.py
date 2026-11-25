from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from weddings.models import RSVPRateWindow


class Command(BaseCommand):
    help = "Delete obsolete RSVP rate-limit counters."

    def handle(self, *args, **options):
        deleted, _ = RSVPRateWindow.objects.filter(window_start__lt=timezone.now() - timedelta(days=1)).delete()
        self.stdout.write(f"Deleted {deleted} obsolete RSVP counters.")
