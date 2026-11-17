from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from weddings.models import WeddingMembership
from weddings.services import create_wedding


class ProfileNameTests(TestCase):
    def setUp(self):
        users = get_user_model().objects
        self.owner = users.create_user(username="owner")
        self.partner = users.create_user(username="partner")
        self.client = APIClient(enforce_csrf_checks=True)
        self.url = reverse("update-profile")
        self.client.get(reverse("csrf"))

    def update(self, payload):
        return self.client.post(
            self.url, payload, format="json", HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value,
        )

    def test_each_member_can_complete_their_own_name_and_both_see_the_same_order(self):
        wedding = create_wedding(user=self.owner, name="Shared Wedding")
        WeddingMembership.objects.create(wedding=wedding, user=self.partner)
        for user, name in ((self.partner, "יובל"), (self.owner, "דנה")):
            self.client.force_login(user)
            self.client.get(reverse("csrf"))
            response = self.update({"first_name": f"  {name}  "})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {"first_name": name})
            self.assertEqual(self.client.get(reverse("me")).json()["first_name"], name)
            self.client.logout()

        for user in (self.owner, self.partner):
            client = APIClient()
            client.force_login(user)
            response = client.get("/api/weddings/?include=memberships")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()[0]["id"], wedding.pk)
            self.assertEqual([member["first_name"] for member in response.json()[0]["memberships"]], ["דנה", "יובל"])

    def test_profile_update_requires_session_and_csrf(self):
        payload = {"first_name": "דנה"}
        self.assertEqual(self.update(payload).status_code, 401)
        self.client.force_login(self.owner)
        for headers in ({}, {"HTTP_X_CSRFTOKEN": "invalid"}):
            response = self.client.post(self.url, payload, format="json", **headers)
            self.assertEqual(response.status_code, 403)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.first_name, "")

    def test_rejects_invalid_names_and_attempts_to_update_other_fields(self):
        self.client.force_login(self.owner)
        for payload in (
            {"first_name": " "},
            {"first_name": 12},
            {"first_name": "א" * 151},
            {"first_name": "דנה\x00"},
            {"first_name": "דנה", "user_id": self.partner.pk},
            {"first_name": "דנה", "username": "changed"},
        ):
            with self.subTest(fields=list(payload)):
                self.assertEqual(self.update(payload).status_code, 400)
        self.owner.refresh_from_db()
        self.partner.refresh_from_db()
        self.assertEqual(self.owner.first_name, "")
        self.assertEqual(self.owner.username, "owner")
        self.assertEqual(self.partner.first_name, "")
