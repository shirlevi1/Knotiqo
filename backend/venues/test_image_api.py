from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from io import StringIO
from threading import Barrier
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.db import IntegrityError, OperationalError, connections
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient

from weddings.models import WeddingMembership
from weddings.services import create_wedding
from .image_previews import PREVIEW_TTL, RATE_LIMIT, database_now, hash_preview_token
from .models import Venue, VenueImage, VenueImagePreview, VenuePreviewRateWindow


WEBSITE = "https://venue.example.com/"
SOURCE = WEBSITE + "gallery"
HALL = WEBSITE + "hall.jpg"
GARDEN = WEBSITE + "garden.jpg"
METADATA_RESULT = {
    "ok": True, "error": None, "metadata": {
        "source_url": SOURCE, "name": "Published name", "description": "Published description",
        "address": "Published address", "phone": "99887766", "images": [
            {"image_url": HALL, "source_url": SOURCE, "alt_text": "Hall"},
            {"image_url": GARDEN, "source_url": SOURCE, "alt_text": "Garden"},
        ],
    },
}


class VenueImageAPITests(TestCase):
    @classmethod
    def setUpTestData(cls):
        users = get_user_model().objects
        cls.owner = users.create_user(username="preview-owner")
        cls.partner = users.create_user(username="preview-partner")
        cls.outsider = users.create_user(username="preview-outsider")
        cls.wedding = create_wedding(user=cls.owner, name="Shared")
        WeddingMembership.objects.create(wedding=cls.wedding, user=cls.partner)
        cls.other_wedding = create_wedding(user=cls.outsider, name="Private")
        cls.venue = Venue.objects.create(
            wedding=cls.wedding, name="Saved", website=WEBSITE, location="Saved city",
            phone="012345678", description="Saved description",
        )
        cls.second_venue = Venue.objects.create(wedding=cls.wedding, name="Second", website=WEBSITE)
        cls.foreign_venue = Venue.objects.create(wedding=cls.other_wedding, name="Private")

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.login(self.owner)
        self.preview_url = self.url(self.venue, "metadata-preview/")
        self.images_url = self.url(self.venue, "images/")
        self.import_metadata = self.enterContext(patch(
            "venues.image_previews.import_venue_metadata", return_value=METADATA_RESULT,
        ))

    def login(self, user):
        self.client.force_login(user)
        self.client.get("/api/auth/csrf/")
        self.headers = {"HTTP_X_CSRFTOKEN": self.client.cookies["csrftoken"].value}

    def url(self, venue, suffix, *, wedding_id=None):
        wedding_id = venue.wedding_id if wedding_id is None else wedding_id
        return f"/api/weddings/{wedding_id}/venues/{venue.pk}/{suffix}"

    def write(self, method, url, data=None):
        return getattr(self.client, method)(url, data, format="json", **self.headers)

    def preview(self, data=None):
        response = self.write("post", self.preview_url, data or {})
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def save(self, token, *images, url=None):
        return self.write("post", url or self.images_url, {"preview_token": token, "images": images})

    def test_preview_defaults_to_saved_website_and_never_writes_venue_or_images(self):
        before = Venue.objects.values().get(pk=self.venue.pk)
        response = self.preview()
        self.import_metadata.assert_called_once_with(WEBSITE)
        self.assertEqual(response["metadata"]["name"], "Published name")
        self.assertEqual(response["expires_in"], PREVIEW_TTL)
        self.assertEqual(len(response["preview_token"]), 43)
        stored = VenueImagePreview.objects.get()
        self.assertEqual(stored.token_hash, hash_preview_token(response["preview_token"]))
        self.assertNotIn("token_hash", response)
        self.assertEqual((stored.user, stored.wedding, stored.venue), (self.owner, self.wedding, self.venue))
        self.assertEqual((stored.website, stored.saved_website), (WEBSITE, WEBSITE))
        self.assertEqual(set(stored.candidates), {HALL, GARDEN})
        self.assertAlmostEqual((stored.expires_at - database_now()).total_seconds(), PREVIEW_TTL, delta=2)
        self.assertEqual(Venue.objects.values().get(pk=self.venue.pk), before)
        self.assertFalse(VenueImage.objects.exists())

        override = "https://other.example.com/"
        token = self.preview({"website": override})["preview_token"]
        self.import_metadata.assert_called_with(override)
        self.assertEqual(VenueImagePreview.objects.get(token_hash=hash_preview_token(token)).website, override)
        self.assertEqual(self.save(token, {"image_url": HALL}).status_code, 200)
        self.assertEqual(Venue.objects.values().get(pk=self.venue.pk), before)

    def test_authentication_and_csrf_apply_before_rate_reservation_or_network(self):
        routes = (
            ("post", self.preview_url), ("post", self.images_url),
            ("delete", self.images_url + "1/"),
        )
        for headers in ({}, {"HTTP_X_CSRFTOKEN": "invalid"}):
            for method, url in routes:
                with self.subTest(method=method, headers=headers):
                    self.assertEqual(getattr(self.client, method)(url, **headers).status_code, 403)
        self.client.logout()
        for method, url in routes:
            self.assertEqual(self.write(method, url).status_code, 403)
        self.assertFalse(VenuePreviewRateWindow.objects.exists())
        self.import_metadata.assert_not_called()

    def test_cross_wedding_and_missing_resources_return_identical_404s(self):
        image = VenueImage.objects.create(venue=self.second_venue, image_url=HALL)
        calls = (
            ("post", self.url(self.foreign_venue, "metadata-preview/")),
            ("post", self.url(self.foreign_venue, "images/", wedding_id=self.wedding.pk)),
            ("post", self.url(self.venue, "metadata-preview/", wedding_id=999999)),
            ("post", f"/api/weddings/{self.wedding.pk}/venues/999999/metadata-preview/"),
            ("delete", self.images_url + f"{image.pk}/"),
            ("delete", self.images_url + "999999/"),
        )
        for method, url in calls:
            with self.subTest(url=url):
                response = self.write(method, url)
                self.assertEqual(response.status_code, 404)
                self.assertEqual(response.data, {"detail": "Not found."})
        self.assertTrue(VenueImage.objects.filter(pk=image.pk).exists())
        self.assertFalse(VenuePreviewRateWindow.objects.exists())
        self.import_metadata.assert_not_called()

    def test_preview_token_rejects_tampering_expiry_and_context_changes(self):
        token = self.preview()["preview_token"]
        tampered = ("A" if token[0] != "A" else "B") + token[1:]
        selection = {"image_url": HALL}
        response = self.save(tampered, selection)
        self.assertEqual(response.data["error"]["code"], "invalid_preview")
        response = self.save(token, selection, url=self.url(self.second_venue, "images/"))
        self.assertEqual(response.data["error"]["code"], "invalid_preview")
        self.login(self.partner)
        self.assertEqual(self.save(token, selection).data["error"]["code"], "invalid_preview")
        self.login(self.owner)
        Venue.objects.filter(pk=self.venue.pk).update(website="https://changed.example.com/")
        self.assertEqual(self.save(token, selection).data["error"]["code"], "invalid_preview")
        Venue.objects.filter(pk=self.venue.pk).update(website=WEBSITE)
        VenueImagePreview.objects.filter(token_hash=hash_preview_token(token)).update(expires_at=database_now())
        self.assertEqual(self.save(token, selection).data["error"]["code"], "invalid_preview")
        self.assertFalse(VenueImage.objects.exists())

    def test_unverified_image_or_source_rejects_the_entire_selection(self):
        token = self.preview()["preview_token"]
        for selection in (
            {"image_url": WEBSITE + "forged.jpg"},
            {"image_url": GARDEN, "source_url": WEBSITE + "forged"},
        ):
            response = self.save(token, {"image_url": HALL}, selection)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.data["error"]["code"], "unverified_image")
        self.assertFalse(VenueImage.objects.exists())
        self.import_metadata.assert_called_once()

    def test_selection_validates_scheme_length_list_bound_and_read_only_fields(self):
        token = self.preview()["preview_token"]
        for images in (
            ({"image_url": "ftp://venue.example.com/hall.jpg"},),
            ({"image_url": WEBSITE + "x" * 500},),
            ({"image_url": HALL, "alt_text": "x" * 256},),
            ({"image_url": HALL, "is_primary": True},),
            ({"image_url": HALL},) * 21,
            (),
        ):
            with self.subTest(images=images):
                self.assertEqual(self.save(token, *images).status_code, 400)
        self.assertFalse(VenueImage.objects.exists())

    def test_member_saves_ordered_selections_with_one_primary_and_deletes_without_renumbering(self):
        self.login(self.partner)
        token = self.preview()["preview_token"]
        response = self.save(
            token, {"image_url": GARDEN, "alt_text": "Chosen alt", "source_url": SOURCE},
            {"image_url": HALL}, {"image_url": GARDEN, "alt_text": "Ignored duplicate"},
        )
        self.assertEqual(response.status_code, 200)
        images = response.data["images"]
        self.assertEqual([image["image_url"] for image in images], [GARDEN, HALL])
        self.assertEqual([image["is_primary"] for image in images], [True, False])
        self.assertEqual([image["sort_order"] for image in images], [0, 1])
        self.assertEqual([image["alt_text"] for image in images], ["Chosen alt", "Hall"])
        self.assertEqual(images[1]["source_url"], SOURCE)
        duplicate = self.save(token, {"image_url": GARDEN, "alt_text": "Never overwrite"})
        self.assertEqual(duplicate.data["images"], images)
        self.assertEqual(self.write("delete", self.images_url + f"{images[0]['id']}/").status_code, 204)
        replay = self.save(token, {"image_url": GARDEN})
        self.assertEqual(replay.status_code, 200)
        self.assertEqual([image["image_url"] for image in replay.data["images"]], [HALL])
        fresh_token = self.preview()["preview_token"]
        self.assertEqual(self.save(fresh_token, {"image_url": GARDEN}).status_code, 200)
        self.assertEqual(
            list(self.venue.images.values_list("image_url", "sort_order", "is_primary")),
            [(HALL, 1, False), (GARDEN, 2, False)],
        )

    def test_per_user_rate_limit_spans_venues_resets_and_returns_retry_after(self):
        start = datetime(2026, 11, 23, tzinfo=timezone.utc)
        with patch("venues.image_previews.database_now", return_value=start) as clock:
            for _ in range(RATE_LIMIT):
                self.preview()
            response = self.write("post", self.url(self.second_venue, "metadata-preview/"), {})
            self.assertEqual(response.status_code, 429)
            self.assertEqual(response.data["error"]["code"], "preview_rate_limited")
            self.assertEqual(response["Retry-After"], "60")
            self.assertEqual(self.import_metadata.call_count, RATE_LIMIT)
            self.login(self.partner)
            self.preview()
            self.login(self.owner)
            clock.return_value = start + timedelta(minutes=1)
            self.preview()
        self.assertEqual(self.import_metadata.call_count, RATE_LIMIT + 2)

    def test_database_failure_blocks_fetch_and_returns_generic_error(self):
        with patch("venues.image_previews.database_now", side_effect=OperationalError("private database host")):
            response = self.write("post", self.preview_url, {})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data["error"]["code"], "preview_unavailable")
        self.assertNotContains(response, "private database host", status_code=503)
        self.import_metadata.assert_not_called()

    def test_failed_image_save_does_not_consume_candidates(self):
        token = self.preview()["preview_token"]
        with patch("venues.views.append_images", side_effect=IntegrityError):
            self.assertEqual(self.save(token, {"image_url": HALL}).status_code, 409)
        self.assertEqual(VenueImagePreview.objects.get().used_image_urls, [])
        self.assertEqual(self.save(token, {"image_url": HALL}).status_code, 200)
        self.assertEqual(VenueImagePreview.objects.get().used_image_urls, [HALL])

    def test_invalid_website_and_structured_fetch_timeout(self):
        response = self.write("post", self.preview_url, {"website": "http://127.0.0.1/"})
        self.assertEqual(response.status_code, 400)
        self.assertFalse(VenuePreviewRateWindow.objects.exists())
        self.import_metadata.assert_not_called()
        self.import_metadata.return_value = {
            "ok": False, "metadata": None,
            "error": {"code": "timeout", "message": "The website request exceeded its time limit."},
        }
        response = self.write("post", self.preview_url, {})
        self.assertEqual(response.status_code, 504)
        self.assertEqual(response.data["error"]["code"], "timeout")

    def test_oversized_json_is_rejected_before_cache_or_fetch(self):
        response = self.client.post(
            self.preview_url, '{"website":"' + "x" * (96 * 1024) + '"}',
            content_type="application/json", **self.headers,
        )
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.data["error"]["code"], "request_too_large")
        self.assertFalse(VenuePreviewRateWindow.objects.exists())
        self.import_metadata.assert_not_called()

    def test_cleanup_preserves_live_tokens_and_recent_rate_windows(self):
        expired = self.preview()["preview_token"]
        active = self.preview()["preview_token"]
        now = database_now()
        VenueImagePreview.objects.filter(token_hash=hash_preview_token(expired)).update(expires_at=now)
        VenuePreviewRateWindow.objects.create(
            user=self.owner, window_start=now - timedelta(hours=2), request_count=5,
        )
        output = StringIO()
        call_command("cleanup_venue_previews", stdout=output)
        self.assertIn("Deleted 1 expired previews and 1 obsolete rate windows.", output.getvalue())
        self.assertEqual(VenueImagePreview.objects.get().token_hash, hash_preview_token(active))
        self.assertEqual(VenuePreviewRateWindow.objects.get().request_count, 2)


class ConcurrentVenueImageTests(TransactionTestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="concurrent-venue-owner")
        wedding = create_wedding(user=self.user, name="Concurrent")
        self.venue = Venue.objects.create(wedding=wedding, name="Venue", website=WEBSITE)
        self.path = f"/api/weddings/{wedding.pk}/venues/{self.venue.pk}/"

    def client_for_user(self):
        client = APIClient()
        client.force_authenticate(self.user)
        return client

    def concurrent_posts(self, suffix, payloads):
        barrier = Barrier(len(payloads), timeout=10)

        def post(data):
            try:
                client = self.client_for_user()
                barrier.wait()
                return client.post(self.path + suffix, data, format="json").status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=len(payloads)) as executor:
            return list(executor.map(post, payloads, timeout=15))

    def test_concurrent_saves_consume_candidates_once_and_keep_one_primary(self):
        with patch("venues.image_previews.import_venue_metadata", return_value=METADATA_RESULT):
            response = self.client_for_user().post(self.path + "metadata-preview/", {}, format="json")
        self.assertEqual(response.status_code, 200)
        payloads = [
            {"preview_token": response.data["preview_token"], "images": [{"image_url": url} for url in urls]}
            for urls in ([HALL], [HALL, GARDEN])
        ]
        self.assertEqual(self.concurrent_posts("images/", payloads), [200, 200])
        self.assertEqual(
            list(self.venue.images.values_list("image_url", "sort_order", "is_primary")),
            [(HALL, 0, True), (GARDEN, 1, False)],
        )
        self.assertEqual(VenueImagePreview.objects.get().used_image_urls, [HALL, GARDEN])

    def test_concurrent_previews_allow_only_five_fetches_in_one_window(self):
        now = datetime(2026, 11, 23, tzinfo=timezone.utc)
        with (
            patch("venues.image_previews.database_now", return_value=now),
            patch("venues.image_previews.import_venue_metadata", return_value=METADATA_RESULT) as fetch,
        ):
            statuses = self.concurrent_posts("metadata-preview/", [{} for _ in range(8)])
        self.assertEqual(sorted(statuses), [200] * RATE_LIMIT + [429] * 3)
        self.assertEqual(fetch.call_count, RATE_LIMIT)
        self.assertEqual(VenuePreviewRateWindow.objects.get().request_count, RATE_LIMIT)
        self.assertEqual(VenueImagePreview.objects.count(), RATE_LIMIT)
