
from datetime import date

from django.contrib.auth import get_user_model
from django.conf import settings
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from weddings.models import Wedding, WeddingMembership


class WeddingAccessTests(TestCase):

    def setUp(self):
        User = get_user_model()

        self.bride = User.objects.create_user(
            username="bride",
            first_name="Dana",
            last_name="Levi",
            email="private@example.com",
            password="test-password-1"
        )

        self.partner = User.objects.create_user(
            username="partner",
            first_name="Yuval",
            password="test-password-2"
        )

        self.stranger = User.objects.create_user(
            username="stranger",
            password="test-password-3"
        )

        self.wedding = Wedding.objects.create(
            name="Our Wedding",
            wedding_date=date(2027, 6, 15),
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
        self.details_url = reverse("wedding-details", args=[self.wedding.pk])

    def test_both_members_can_retrieve_the_same_details(self):
        expected = {
            "id": self.wedding.pk,
            "name": "Our Wedding",
            "wedding_date": "2027-06-15",
            "creator_display_name": "",
            "partner_display_name": "",
            "memberships": [
                {"display_name": "Dana Levi", "first_name": "Dana"},
                {"display_name": "Yuval", "first_name": "Yuval"},
            ],
        }
        for user in (self.bride, self.partner):
            with self.subTest(user=user.username):
                client = APIClient(enforce_csrf_checks=True)
                client.force_login(user)
                response = client.get(self.details_url)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), expected)
                self.assertIn("no-store", response.headers["Cache-Control"])
                workspace = client.get("/api/weddings/?include=memberships")
                self.assertEqual(workspace.status_code, 200)
                self.assertEqual(workspace.json(), [expected])

    def test_single_membership_and_missing_date(self):
        wedding = Wedding.objects.create(name="New Wedding")
        WeddingMembership.objects.create(wedding=wedding, user=self.bride)
        self.client.force_authenticate(user=self.bride)

        response = self.client.get(reverse("wedding-details", args=[wedding.pk]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "id": wedding.pk,
            "name": "New Wedding",
            "wedding_date": None,
            "creator_display_name": "",
            "partner_display_name": "",
            "memberships": [{"display_name": "Dana Levi", "first_name": "Dana"}],
        })

    def test_non_member_cannot_distinguish_private_wedding_from_missing_wedding(self):
        self.client.force_authenticate(user=self.stranger)
        forbidden = self.client.get(self.details_url)
        missing = self.client.get(reverse("wedding-details", args=[0]))
        self.assertEqual(forbidden.status_code, 404)
        self.assertEqual(forbidden.json(), missing.json())
        self.assertEqual(missing.status_code, 404)

    def test_anonymous_user_cannot_retrieve_details(self):
        response = self.client.get(self.details_url)
        self.assertEqual(response.status_code, 403)
        self.assertNotIn("memberships", response.json())

    def test_expanded_list_prefetches_memberships_for_authorized_weddings(self):
        second = Wedding.objects.create(name="Second Wedding")
        WeddingMembership.objects.create(wedding=second, user=self.bride)
        WeddingMembership.objects.create(wedding=second, user=self.stranger)
        private = Wedding.objects.create(name="Private Wedding")
        WeddingMembership.objects.create(wedding=private, user=self.stranger)
        self.client.force_authenticate(user=self.bride)

        with self.assertNumQueries(2):
            response = self.client.get("/api/weddings/?include=memberships")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [(wedding["id"], wedding["memberships"]) for wedding in response.json()],
            [
                (self.wedding.pk, [
                    {"display_name": "Dana Levi", "first_name": "Dana"},
                    {"display_name": "Yuval", "first_name": "Yuval"},
                ]),
                (second.pk, [
                    {"display_name": "Dana Levi", "first_name": "Dana"},
                    {"display_name": "stranger", "first_name": None},
                ]),
            ],
        )

    def test_email_like_login_name_is_not_exposed_as_display_name(self):
        self.partner.username = "private-login@example.com"
        self.partner.first_name = ""
        self.partner.save(update_fields=["username", "first_name"])
        self.client.force_authenticate(user=self.bride)

        response = self.client.get(self.details_url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["memberships"][1], {"display_name": None, "first_name": None})

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
