
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.test import TestCase
from rest_framework.test import APIClient

from weddings.models import Wedding, WeddingMembership
from weddings.services import create_wedding


class WeddingCreationTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.user = get_user_model().objects.create_user(
            username="creator",
            password="IsolatedWedding#2026!",
        )

        cls.other_user = get_user_model().objects.create_user(
            username="other"
        )

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.client.force_authenticate(user=self.user)

    def test_create_wedding_and_creator_membership(self):
        response = self.client.post(
            "/api/weddings/",
            {
                "name": "  Our Wedding  ",
                "wedding_date": "2027-06-15"
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)

        wedding = Wedding.objects.get(
            pk=response.data["id"]
        )

        self.assertEqual(
            response.json(),
            {
                "id": wedding.id,
                "name": "Our Wedding",
                "wedding_date": "2027-06-15",
            }
        )

        self.assertEqual(
            list(wedding.members.all()),
            [self.user]
        )

        self.assertEqual(
            WeddingMembership.objects.filter(
                wedding=wedding
            ).count(),
            1
        )

        self.assertEqual(
            self.client.get("/api/weddings/").json(),
            [response.json()]
        )

        self.client.force_authenticate(user=self.other_user)

        self.assertEqual(
            self.client.get("/api/weddings/").json(),
            []
        )

    def test_date_is_optional_or_null(self):
        for payload in (
                {"name": "No date"},
                {"name": "Not decided", "wedding_date": None},
        ):
            with self.subTest(payload=payload):
                response = self.client.post(
                    "/api/weddings/",
                    payload,
                    format="json"
                )

                self.assertEqual(response.status_code, 201)
                self.assertIsNone(response.data["wedding_date"])

    def test_list_includes_all_own_weddings_and_no_other_weddings(self):
        own = [
            create_wedding(user=self.user, name=name)
            for name in ("First", "Second")
        ]

        create_wedding(
            user=self.other_user,
            name="Private"
        )

        response = self.client.get("/api/weddings/")

        self.assertEqual(response.status_code, 200)

        self.assertEqual(
            [w["id"] for w in response.json()],
            [w.id for w in own]
        )

    def test_anonymous_creation_is_rejected(self):
        self.client.force_authenticate(user=None)

        response = self.client.post(
            "/api/weddings/",
            {"name": "Private"},
            format="json"
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(Wedding.objects.exists())

    def test_invalid_input_creates_no_records(self):
        payloads = [
            {},
            {"name": ""},
            {"name": "   "},
            {"name": None},
            {"name": 42},
            {"name": True},
            {"name": ["Wedding"]},
            {"name": "x" * 151},
            {"name": "Wedding", "wedding_date": "not-a-date"},
            {"name": "Wedding", "wedding_date": "2027-02-30"},
            {"name": "Wedding", "wedding_date": ""},
            {"name": "Wedding", "wedding_date": 20270615},
            {"name": "Wedding", "wedding_date": ["2027-06-15"]},
            [],
            "invalid body",
        ]

        for payload in payloads:
            with self.subTest(payload=payload):
                response = self.client.post(
                    "/api/weddings/",
                    payload,
                    format="json"
                )

                self.assertEqual(response.status_code, 400)
                self.assertFalse(Wedding.objects.exists())
                self.assertFalse(WeddingMembership.objects.exists())

    def test_client_cannot_assign_users_or_memberships(self):
        for field in (
                "user_id",
                "members",
                "membership_id",
                "id",
        ):
            with self.subTest(field=field):
                response = self.client.post(
                    "/api/weddings/",
                    {
                        "name": "Wedding",
                        field: self.other_user.id
                    },
                    format="json",
                )

                self.assertEqual(response.status_code, 400)
                self.assertFalse(Wedding.objects.exists())
                self.assertFalse(WeddingMembership.objects.exists())

    def test_membership_failure_rolls_back_wedding(self):
        with patch(
                "weddings.services.WeddingMembership.objects.create",
                side_effect=IntegrityError
        ):
            with self.assertRaises(IntegrityError):
                create_wedding(
                    user=self.user,
                    name="Must roll back"
                )

        self.assertFalse(Wedding.objects.exists())
        self.assertFalse(WeddingMembership.objects.exists())

    def test_real_session_requires_csrf_and_survives_new_client(self):
        client = APIClient(enforce_csrf_checks=True)

        client.get("/api/auth/csrf/")

        response = client.post(
            "/api/auth/login/",
            {
                "username": "creator",
                "password": "IsolatedWedding#2026!"
            },
            format="json",
            HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
        )

        self.assertEqual(response.status_code, 200)

        for headers in (
                {},
                {"HTTP_X_CSRFTOKEN": "invalid"},
        ):
            response = client.post(
                "/api/weddings/",
                {"name": "Blocked"},
                format="json",
                **headers
            )

            self.assertEqual(response.status_code, 403)
            self.assertFalse(Wedding.objects.exists())

        response = client.post(
            "/api/weddings/",
            {"name": "Shared future"},
            format="json",
            HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
        )

        self.assertEqual(response.status_code, 201)

        restored = APIClient(enforce_csrf_checks=True)

        restored.cookies[settings.SESSION_COOKIE_NAME] = (
            client.cookies[settings.SESSION_COOKIE_NAME].value
        )

        self.assertEqual(
            restored.get("/api/weddings/").json(),
            [response.json()]
        )
