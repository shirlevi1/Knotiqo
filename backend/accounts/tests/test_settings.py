from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from weddings.models import WeddingMembership
from weddings.services import create_wedding


class SettingsTests(TestCase):
    def setUp(self):
        users = get_user_model().objects
        self.owner = users.create_user(username="owner", email="owner@example.com", password="Original!Password42")
        self.partner = users.create_user(username="partner", email="partner@example.com")
        self.outsider = users.create_user(username="outsider")
        self.wedding = create_wedding(user=self.owner, name="Wedding", creator_display_name="Couple name")
        WeddingMembership.objects.create(wedding=self.wedding, user=self.partner)
        self.client = APIClient(enforce_csrf_checks=True)

    def login(self, user):
        self.client.force_login(user)
        self.client.get(reverse("csrf"))
        return {"HTTP_X_CSRFTOKEN": self.client.cookies["csrftoken"].value}

    def test_profile_is_personal_and_duplicate_email_is_rejected(self):
        url = reverse("update-profile")
        self.assertEqual(self.client.get(url).status_code, 401)
        headers = self.login(self.owner)
        profile = {"first_name": "Personal", "last_name": "Name", "email": "new@example.com"}
        for email in ("PARTNER@example.com", "invalid"):
            self.assertEqual(self.client.post(url, {**profile, "email": email}, format="json", **headers).status_code, 400)
        self.assertEqual(self.client.post(url, profile, format="json", **headers).json(), profile)
        self.assertEqual(self.client.get(url).json(), profile)
        self.wedding.refresh_from_db()
        self.assertEqual(self.wedding.creator_display_name, "Couple name")
        self.login(self.partner)
        self.assertEqual(self.client.get(url).json()["email"], "partner@example.com")

    def test_password_requires_csrf_current_password_confirmation_and_validation(self):
        url = reverse("change-password")
        headers = self.login(self.owner)
        payload = {"old_password": "Original!Password42", "new_password": "Replacement!Password84",
                   "confirm_password": "Replacement!Password84"}
        self.assertEqual(self.client.post(url, payload, format="json").status_code, 403)
        for changes in ({"old_password": "wrong"}, {"confirm_password": "different"},
                        {"new_password": "123", "confirm_password": "123"}):
            response = self.client.post(url, {**payload, **changes}, format="json", **headers)
            self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.post(url, payload, format="json", **headers).status_code, 200)
        self.assertEqual(self.client.get(reverse("me")).status_code, 200)
        self.owner.refresh_from_db()
        self.assertTrue(self.owner.check_password(payload["new_password"]))

    def test_date_requires_membership_and_csrf_and_is_shared(self):
        url = f"/api/weddings/{self.wedding.pk}/"
        payload = {"wedding_date": "2027-06-15"}
        headers = self.login(self.outsider)
        missing = self.client.patch("/api/weddings/999999/", payload, format="json", **headers)
        foreign = self.client.patch(url, payload, format="json", **headers)
        self.assertEqual(foreign.status_code, 404)
        self.assertEqual(foreign.json(), missing.json())
        headers = self.login(self.partner)
        self.assertEqual(self.client.patch(url, payload, format="json").status_code, 403)
        self.assertEqual(self.client.patch(url, {"wedding_date": "2027-02-30"}, format="json", **headers).status_code, 400)
        self.assertEqual(self.client.patch(url, payload, format="json", **headers).json(), payload)
        headers = self.login(self.owner)
        self.assertEqual(self.client.get(url).json()["wedding_date"], payload["wedding_date"])
        self.assertEqual(self.client.patch(url, {"wedding_date": None}, format="json", **headers).json(),
                         {"wedding_date": None})
