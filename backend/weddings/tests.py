from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from .models import Wedding, WeddingMembership


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