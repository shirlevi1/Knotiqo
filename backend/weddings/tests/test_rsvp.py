import hashlib
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from weddings.models import Guest, GuestRSVP, WeddingMembership
from weddings.services import create_wedding


@override_settings(PUBLIC_BASE_URL="https://rsvp.knotiqo-fixture.com", ALLOWED_HOSTS=["rsvp.knotiqo-fixture.com", "testserver"])
class RSVPTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        users = get_user_model().objects
        cls.owner = users.create_user(username="rsvp-owner")
        cls.partner = users.create_user(username="rsvp-partner")
        cls.outsider = users.create_user(username="rsvp-outsider")
        cls.wedding = create_wedding(user=cls.owner, name="Private wedding",
                                     creator_display_name="דנה", partner_display_name="גל")
        cls.other = create_wedding(user=cls.outsider, name="Other")
        WeddingMembership.objects.create(user=cls.partner, wedding=cls.wedding)
        cls.guest = Guest.objects.create(wedding=cls.wedding, full_name="Private guest", phone="0501234567",
                                         email="private@example.com", party_size=5,
                                         adult_count=2, child_count=2, infant_count=1)
        cls.legacy = Guest.objects.create(wedding=cls.wedding, full_name="Legacy", party_size=3)

    def setUp(self):
        self.members = APIClient(enforce_csrf_checks=True)
        self.login(self.owner)
        self.public = APIClient(enforce_csrf_checks=True)
        self.site = {"secure": True, "HTTP_HOST": "rsvp.knotiqo-fixture.com"}
        self.public.get("/api/auth/csrf/", **self.site)
        self.public_headers = {**self.site, "HTTP_ORIGIN": "https://rsvp.knotiqo-fixture.com",
                               "HTTP_X_CSRFTOKEN": self.public.cookies["csrftoken"].value}

    def login(self, user):
        self.members.force_login(user)
        self.members.get("/api/auth/csrf/")
        self.csrf = {"HTTP_X_CSRFTOKEN": self.members.cookies["csrftoken"].value}

    def path(self, guest=None, wedding=None):
        return f"/api/weddings/{wedding or self.wedding.pk}/guests/{(guest or self.guest).pk}/rsvp-link/"

    def issue(self, guest=None):
        result = self.members.post(self.path(guest), {}, format="json", **self.csrf)
        self.assertEqual(result.status_code, 201, result.json())
        self.assertEqual(result.json()["url"].split("/#/rsvp/")[0], "https://rsvp.knotiqo-fixture.com")
        return result.json()["url"].rsplit("/", 1)[-1]

    def visit(self, token, action="read", **fields):
        return self.public.post("/api/rsvp/", {"token": token, "action": action, **fields},
                                format="json", **self.public_headers)

    def test_privacy_and_token_lifecycle(self):
        token = self.issue()
        second = self.issue(self.legacy)
        saved = GuestRSVP.objects.get(guest=self.guest)
        self.assertEqual(saved.token_hash, hashlib.sha256(token.encode()).hexdigest())
        data = self.visit(token).json()
        self.assertEqual(set(data), {"creator_display_name", "partner_display_name", "wedding_date",
                                    "invited_count", "age_limits", "options"})
        self.assertEqual(data["invited_count"], 5)
        self.assertEqual(data["age_limits"], {"adult_count": 2, "child_count": 2, "infant_count": 1})
        self.assertNotIn("url", self.members.get(self.path()).json())
        replacement = self.issue()
        self.assertEqual(self.visit(token).json(), self.visit("a" * 43).json())
        self.assertEqual(self.visit(token).status_code, 404)
        self.assertEqual(self.visit(second).status_code, 200)
        self.assertEqual(self.members.delete(self.path(), **self.csrf).status_code, 200)
        self.assertEqual(self.visit(replacement).status_code, 404)
        GuestRSVP.objects.filter(guest=self.legacy).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.visit(second).status_code, 404)

    def test_partial_age_limits_and_idempotent_replacement_visible_to_partner(self):
        token = self.issue()
        for values in ({"adult_count": 3, "child_count": 0, "infant_count": 0},
                       {"adult_count": True, "child_count": 1, "infant_count": 0},
                       {"attendee_count": 3}, {"adult_count": 0, "child_count": 0, "infant_count": 0}):
            self.assertEqual(self.visit(token, "respond", status="attending", **values).status_code, 400)
        self.assertEqual(self.visit(token, "respond", status="attending", adult_count=1, child_count=1, infant_count=0).status_code, 200)
        self.login(self.partner)
        first = self.members.get(self.path()).json()["response"]
        self.assertEqual((first["attendee_count"], first["adult_count"], first["child_count"]), (2, 1, 1))
        self.assertEqual(self.visit(token, "respond", status="attending", adult_count=1, child_count=1, infant_count=0).status_code, 200)
        self.assertEqual(self.members.get(self.path()).json()["response"], first)
        self.assertEqual(self.visit(token, "respond", status="maybe").status_code, 200)
        self.assertEqual(self.members.get(self.path()).json()["response"]["attendee_count"], 0)
        self.assertEqual(GuestRSVP.objects.filter(guest=self.guest).count(), 1)
        legacy = self.issue(self.legacy)
        self.assertIsNone(self.visit(legacy).json()["age_limits"])
        self.assertEqual(self.visit(legacy, "respond", status="attending", attendee_count=4).status_code, 400)
        self.assertEqual(self.visit(legacy, "respond", status="attending", attendee_count=2).status_code, 200)
        self.assertIsNone(self.members.get(self.path(self.legacy)).json()["response"]["adult_count"])

    def test_auth_csrf_origin_and_local_sharing_gate(self):
        self.assertEqual(self.members.post(self.path(), {}, format="json").status_code, 403)
        token = self.issue()
        self.login(self.outsider)
        self.assertEqual(self.members.get(self.path()).status_code, 404)
        self.assertEqual(self.members.get(self.path(wedding=self.other.pk)).status_code, 404)
        self.assertEqual(self.members.delete(self.path(), **self.csrf).status_code, 404)
        self.assertEqual(self.public.post("/api/rsvp/", {"token": token, "action": "read"}, format="json", **self.site).status_code, 403)
        self.assertEqual(self.public.post("/api/rsvp/", {"token": token, "action": "read"}, format="json",
                                         **{**self.public_headers, "HTTP_ORIGIN": "https://foreign.invalid"}).status_code, 403)
        self.login(self.owner)
        for url in ("", "http://localhost:5173", "https://127.0.0.1", "https://machine.local", "https://example.com"):
            with self.settings(PUBLIC_BASE_URL=url):
                self.assertFalse(self.members.get(self.path()).json()["sharing_enabled"])
                self.assertEqual(self.members.post(self.path(), {}, format="json", **self.csrf).status_code, 409)
                self.assertEqual(self.visit(token).status_code, 404)

    def test_rate_limits_and_archiving_revokes_without_losing_response(self):
        token = self.issue()
        for _ in range(12):
            self.assertEqual(self.visit(token, "respond", status="declining").status_code, 200)
        self.assertEqual(self.visit(token).status_code, 429)
        detail = self.path().removesuffix("rsvp-link/")
        self.assertEqual(self.members.delete(detail, **self.csrf).status_code, 204)
        self.members.patch(detail, {"is_archived": False}, format="json", **self.csrf)
        self.assertEqual(self.visit(token).status_code, 404)
        self.assertEqual(self.members.get(self.path()).json()["response"]["status"], "declining")
