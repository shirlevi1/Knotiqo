from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import DatabaseError
from django.test import TransactionTestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from .models import Wedding, WeddingMembership
from .services import create_wedding


class WeddingCoverTests(TransactionTestCase):
    def setUp(self):
        self.media = Path(self.enterContext(TemporaryDirectory()))
        self.enterContext(override_settings(MEDIA_ROOT=self.media))
        users = get_user_model().objects
        self.owner = users.create_user(username="cover-owner")
        self.partner = users.create_user(username="cover-partner")
        self.outsider = users.create_user(username="cover-outsider")
        self.wedding = create_wedding(user=self.owner, name="Shared")
        WeddingMembership.objects.create(wedding=self.wedding, user=self.partner)
        self.other = create_wedding(user=self.outsider, name="Private")
        self.path = f"/api/weddings/{self.wedding.pk}/cover/"
        self.login(self.owner)

    def login(self, user):
        self.client = APIClient(enforce_csrf_checks=True)
        self.client.force_login(user)
        self.client.get("/api/auth/csrf/")
        self.headers = {"HTTP_X_CSRFTOKEN": self.client.cookies["csrftoken"].value}

    def image(self, fmt="PNG", size=(32, 24)):
        data = BytesIO()
        with Image.new("1" if size[0] > 1000 else "RGB", size) as image:
            exif = Image.Exif()
            exif[270] = "Private description"
            image.save(data, fmt, exif=exif)
        return SimpleUploadedFile("untrusted.svg", data.getvalue(), content_type="application/octet-stream")

    def upload(self, image=None, **extra):
        return self.client.post(self.path, {"cover": image or self.image(), **extra}, **self.headers)

    def files(self):
        return list(self.media.glob("wedding-covers/*"))

    def test_shared_private_cover_and_normalized_content(self):
        detail = f"/api/weddings/{self.wedding.pk}/"
        self.assertIsNone(self.client.get(detail).json()["cover_image_url"])
        for fmt in ("JPEG", "PNG", "WEBP"):
            response = self.upload(self.image(fmt))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(self.files()), 1)
        url = response.json()["cover_image_url"]
        self.assertTrue(url.startswith(self.path + "?v="))
        self.login(self.partner)
        self.assertEqual(self.client.get(detail).json()["cover_image_url"], url)
        self.assertEqual(self.client.get("/api/weddings/").json()[0]["cover_image_url"], url)
        download = self.client.get(url)
        self.assertEqual(download["Content-Type"], "image/webp")
        self.assertIn("no-store", download["Cache-Control"])
        with Image.open(BytesIO(download.content)) as body:
            self.assertEqual(body.format, "WEBP")
            self.assertFalse(body.getexif())
        other = f"/api/weddings/{self.other.pk}/cover/"
        self.assertEqual(self.client.get(other).status_code, 404)
        self.login(self.outsider)
        for inaccessible in (url, "/api/weddings/0/cover/"):
            self.assertEqual(self.client.get(inaccessible).json(), {"detail": "Not found."})
            self.assertEqual(self.client.post(inaccessible, {"cover": self.image()}, **self.headers).status_code, 404)
            self.assertEqual(self.client.delete(inaccessible, **self.headers).status_code, 404)

    def test_csrf_and_invalid_uploads(self):
        self.assertEqual(self.client.post(self.path, {"cover": self.image()}).status_code, 403)
        self.assertEqual(self.client.delete(self.path).status_code, 403)
        cases = (
            (SimpleUploadedFile("payload.svg", b"<svg/>"), 400, "invalid_image"),
            (SimpleUploadedFile("broken.jpg", b"\xff\xd8bad"), 400, "invalid_image"),
            (SimpleUploadedFile("big.png", b"x" * (5 * 1024 * 1024 + 1)), 413, "too_large"),
            (self.image(size=(4500, 4500)), 400, "unsafe_dimensions"),
        )
        for upload, status, code in cases:
            response = self.upload(upload)
            self.assertEqual((response.status_code, response.json()), (status, {"code": code}))
        self.assertEqual(self.upload(wedding_id=self.other.pk).json(), {"code": "invalid_upload"})
        self.assertEqual(self.files(), [])

    def test_replacement_failures_keep_the_old_cover_and_removal_cleans_up(self):
        previous = self.upload().json()["cover_image_url"]
        old = self.files()[0]
        storage = Wedding._meta.get_field("cover_image").storage
        with patch.object(storage, "save", side_effect=OSError("private storage path")):
            self.assertEqual(self.upload().json(), {"code": "storage_unavailable"})
        with patch.object(Wedding, "save", side_effect=DatabaseError):
            self.assertEqual(self.upload().status_code, 503)
        self.assertEqual(self.files(), [old])
        self.assertEqual(self.client.get(previous).status_code, 200)
        self.login(self.partner)
        self.assertNotEqual(self.upload().json()["cover_image_url"], previous)
        self.assertFalse(old.exists())
        self.assertEqual(len(self.files()), 1)
        response = self.client.delete(self.path, **self.headers)
        self.assertEqual(response.json(), {"cover_image_url": None})
        self.assertEqual(self.files(), [])
        self.assertEqual(self.client.get(self.path).status_code, 404)
        self.assertEqual(self.upload().status_code, 200)
        self.wedding.delete()
        self.assertEqual(self.files(), [])
