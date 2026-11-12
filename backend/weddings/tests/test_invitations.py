
import hashlib
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from weddings.models import Wedding, WeddingInvitation, WeddingMembership
from weddings.services import create_partner_invitation


class WeddingInvitationTests(TestCase):

    def setUp(self):
        User = get_user_model()

        self.bride = User.objects.create_user(
            username="bride",
            email="bride@example.com",
            password="TestPassword123!",
        )

        self.wedding = Wedding.objects.create(
            name="Our Wedding"
        )

        WeddingMembership.objects.create(
            wedding=self.wedding,
            user=self.bride,
        )

    def test_create_partner_invitation(self):
        invitation, token = create_partner_invitation(
            wedding=self.wedding,
            invited_by=self.bride,
            email="partner@example.com",
        )

        self.assertEqual(
            invitation.status,
            WeddingInvitation.InvitationStatus.PENDING,
        )

        self.assertEqual(
            invitation.invited_email,
            "partner@example.com",
        )

        self.assertEqual(
            invitation.token_hash,
            hashlib.sha256(token.encode("utf-8")).hexdigest(),
        )

        self.assertAlmostEqual(
            invitation.expires_at,
            timezone.now() + timedelta(days=7),
            delta=timedelta(seconds=5),
            )


class WeddingInvitationAPITests(TestCase):

    def setUp(self):
        User = get_user_model()

        self.bride = User.objects.create_user(
            username="bride_api",
            email="bride_api@example.com",
            password="TestPassword123!",
        )

        self.wedding = Wedding.objects.create(
            name="API Test Wedding"
        )

        WeddingMembership.objects.create(
            wedding=self.wedding,
            user=self.bride,
        )

        self.client = APIClient()
        self.client.force_authenticate(user=self.bride)

        self.url = f"/api/weddings/{self.wedding.id}/invitations/"

    def test_member_can_create_invitation(self):
        response = self.client.post(
            self.url,
            {"email": "partner@example.com"},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["email"], "partner@example.com")
        self.assertEqual(response.data["status"], "pending")

        self.assertTrue(
            WeddingInvitation.objects.filter(
                wedding=self.wedding,
                invited_email="partner@example.com",
            ).exists()
        )

    def test_non_member_cannot_create_invitation(self):
        stranger = get_user_model().objects.create_user(
            username="stranger_api",
            password="TestPassword123!",
        )

        self.client.force_authenticate(user=stranger)

        response = self.client.post(
            self.url,
            {"email": "partner@example.com"},
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(WeddingInvitation.objects.exists())

    def test_duplicate_invitation_is_rejected(self):
        payload = {"email": "partner@example.com"}

        first = self.client.post(self.url, payload, format="json")
        second = self.client.post(self.url, payload, format="json")

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 400)
        self.assertEqual(WeddingInvitation.objects.count(), 1)

    def test_invalid_email_is_rejected(self):
        response = self.client.post(
            self.url,
            {"email": "not-an-email"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(WeddingInvitation.objects.exists())

    def test_anonymous_user_cannot_create_invitation(self):
        self.client.force_authenticate(user=None)

        response = self.client.post(
            self.url,
            {"email": "partner@example.com"},
            format="json",
        )

        self.assertIn(response.status_code, [401, 403])
        self.assertFalse(WeddingInvitation.objects.exists())
