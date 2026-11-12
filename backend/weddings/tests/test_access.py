
from django.contrib.auth import get_user_model
from django.conf import settings
from django.test import TestCase
from rest_framework.test import APIClient

from weddings.models import Wedding, WeddingMembership


class WeddingAccessTests(TestCase):

    def setUp(self):
        User = get_user_model()

        self.bride = User.objects.create_user(
            username="bride",
            password="test-password-1"
        )

        self.partner = User.objects.create_user(
            username="partner",
            password="test-password-2"
        )

        self.stranger = User.objects.create_user(
            username="stranger",
            password="test-password-3"
        )

        self.wedding = Wedding.objects.create(
            name="Our Wedding"
        )

        WeddingMembership.objects.create(
            wedding=self.wedding,
            user=self.bride
        )

        WeddingMembership.objects.create(
            wedding=self.wedding,
            user=self.partner
        )

        self.client = APIClient()

    def test_both_members_can_see_wedding(self):
        for user in [self.bride, self.partner]:
            self.client.force_authenticate(user=user)

            response = self.client.get("/api/weddings/")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(response.data), 1)
            self.assertEqual(
                response.data[0]["id"],
                self.wedding.id
            )

    def test_stranger_cannot_see_wedding(self):
        self.client.force_authenticate(user=self.stranger)

        response = self.client.get("/api/weddings/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, [])

    def test_anonymous_user_cannot_access_api(self):
        self.client.force_authenticate(user=None)

        response = self.client.get("/api/weddings/")

        self.assertIn(response.status_code, [401, 403])

    def test_real_login_session_limits_weddings_and_logout_revokes_access(self):
        other_wedding = Wedding.objects.create(
            name="Another Wedding"
        )

        WeddingMembership.objects.create(
            wedding=other_wedding,
            user=self.stranger
        )

        for user, password, expected_wedding in (
                (self.bride, "test-password-1", self.wedding),
                (self.partner, "test-password-2", self.wedding),
                (self.stranger, "test-password-3", other_wedding),
        ):
            with self.subTest(user=user.username):
                client = APIClient(enforce_csrf_checks=True)

                client.get("/api/auth/csrf/")

                response = client.post(
                    "/api/auth/login/",
                    {
                        "username": user.username,
                        "password": password
                    },
                    format="json",
                    HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
                )

                self.assertEqual(response.status_code, 200)

                self.assertEqual(
                    client.get("/api/auth/me/").json()["id"],
                    user.id
                )

                response = client.get("/api/weddings/")

                self.assertEqual(response.status_code, 200)

                self.assertEqual(
                    [w["id"] for w in response.data],
                    [expected_wedding.id]
                )

                old_session = client.cookies[
                    settings.SESSION_COOKIE_NAME
                ].value

                response = client.post(
                    "/api/auth/logout/",
                    HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
                )

                self.assertEqual(response.status_code, 200)

                self.assertEqual(
                    client.get("/api/auth/me/").status_code,
                    401
                )

                self.assertIn(
                    client.get("/api/weddings/").status_code,
                    [401, 403]
                )

                # An invalidated session must not be restored.
                client.cookies[settings.SESSION_COOKIE_NAME] = old_session

                self.assertEqual(
                    client.get("/api/auth/me/").status_code,
                    401
                )
