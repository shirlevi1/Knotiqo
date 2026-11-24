from django.core.management.base import BaseCommand
from django.db.models.functions import Now

from weddings.models import GuestImportSession


class Command(BaseCommand):
    help = "Delete expired guest import sessions and their temporary data."

    def handle(self, *args, **options):
        count, _ = GuestImportSession.objects.filter(expires_at__lte=Now()).delete()
        self.stdout.write(f"Deleted {count} expired guest import sessions.")
