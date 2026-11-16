from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, close_old_connections, connection, connections, transaction
from django.test import TestCase, TransactionTestCase, skipUnlessDBFeature
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from weddings.models import Wedding, WeddingInvitation, WeddingMembership
from weddings.services import accept_partner_invitation, create_partner_invitation, create_wedding


def create_participants():
    users = get_user_model().objects
    owner = users.create_user(username="owner", email="owner@example.com")
    partner = users.create_user(username="partner", email="PARTNER@example.com")
    stranger = users.create_user(username="stranger", email="stranger@example.com")
    return owner, partner, stranger


class InvitationAcceptanceTests(TestCase):
    def setUp(self):
        self.owner, self.partner, self.stranger = create_participants()
        self.wedding = create_wedding(user=self.owner, name="Our Wedding")
        self.invitation, self.token = create_partner_invitation(
            wedding=self.wedding, invited_by=self.owner, email="partner@example.com"
        )
        self.accept_url = reverse("accept-invitation")
        self.preview_url = reverse("validate-invitation")
        self.payload = {"token": self.token}

    def assert_pending(self, members=1):
        self.invitation.refresh_from_db()
        self.assertEqual(self.invitation.status, WeddingInvitation.InvitationStatus.PENDING)
        self.assertIsNone(self.invitation.accepted_at)
        self.assertEqual(self.wedding.memberships.count(), members)

    def test_preview_is_public_minimal_and_read_only(self):
        self.wedding.wedding_date = timezone.localdate()
        self.wedding.save(update_fields=["wedding_date"])
        response = self.client.post(self.preview_url, self.payload, content_type="application/json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"name": self.wedding.name})
        self.assertIn("no-store", response.headers["Cache-Control"])
        self.assert_pending()

    def test_anonymous_cannot_accept(self):
        self.assertEqual(APIClient().post(self.accept_url, self.payload).status_code, 403)
        self.assert_pending()

    def test_session_csrf_and_successful_acceptance(self):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.partner)
        client.get("/api/auth/csrf/")
        csrf = client.cookies["csrftoken"].value
        for headers in ({}, {"X-CSRFToken": "invalid"}):
            with self.subTest(headers=headers):
                response = client.post(self.accept_url, self.payload, format="json", headers=headers)
                self.assertEqual(response.status_code, 403)
                self.assert_pending()

        response = client.post(
            self.accept_url, self.payload, format="json", headers={"X-CSRFToken": csrf}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"id": self.wedding.pk, "name": self.wedding.name, "wedding_date": None})
        self.assertEqual(Wedding.objects.count(), 1)
        self.assertEqual(set(self.wedding.members.all()), {self.owner, self.partner})
        self.invitation.refresh_from_db()
        self.assertEqual(self.invitation.status, WeddingInvitation.InvitationStatus.ACCEPTED)
        self.assertIsNotNone(self.invitation.accepted_at)
        replay = client.post(
            self.accept_url, self.payload, format="json", headers={"X-CSRFToken": csrf}
        )
        self.assertEqual(replay.status_code, 404)
        self.assertEqual(self.wedding.memberships.count(), 2)

        for member in (self.owner, self.partner):
            refreshed = APIClient()
            refreshed.force_login(member)
            self.assertEqual(refreshed.get("/api/weddings/").json(), [response.json()])
            details = refreshed.get(reverse("wedding-details", args=[self.wedding.pk]))
            self.assertEqual(details.status_code, 200)
            self.assertEqual(details.json(), {
                **response.json(),
                "memberships": [{"display_name": "owner"}, {"display_name": "partner"}],
            })

    def post_as(self, user, payload=None):
        client = APIClient()
        client.force_authenticate(user=user)
        return client.post(self.accept_url, self.payload if payload is None else payload, format="json")

    def test_wrong_email_cannot_accept(self):
        self.assertEqual(self.post_as(self.stranger).status_code, 403)
        self.assert_pending()

    def test_matching_account_email_without_valid_token_cannot_accept(self):
        unknown_token = ("b" if self.token[0] == "a" else "a") + self.token[1:]
        payload = {"token": unknown_token}
        preview = self.client.post(self.preview_url, payload, content_type="application/json")
        self.assertEqual(preview.status_code, 404)
        self.assertEqual(preview.json(), {"detail": "Invitation unavailable."})
        self.assertEqual(self.post_as(self.partner, payload).status_code, 404)
        self.assert_pending()

    def test_creator_cannot_accept_even_if_email_matches(self):
        self.invitation.invited_email = self.owner.email
        self.invitation.save(update_fields=["invited_email"])
        self.assertEqual(self.post_as(self.owner).status_code, 403)
        self.assert_pending()

    def test_existing_member_cannot_accept(self):
        WeddingMembership.objects.create(wedding=self.wedding, user=self.partner)
        self.wedding.memberships.filter(user=self.owner).delete()
        self.assertEqual(self.post_as(self.partner).status_code, 409)
        self.assert_pending()

    def test_third_member_cannot_join(self):
        WeddingMembership.objects.create(wedding=self.wedding, user=self.stranger)
        self.assertEqual(self.post_as(self.partner).status_code, 409)
        self.assert_pending(members=2)

    def test_expired_revoked_and_accepted_invitations_are_unavailable(self):
        expiry = self.invitation.expires_at
        for status, expires_at in (
            (WeddingInvitation.InvitationStatus.PENDING, timezone.now()),
            (WeddingInvitation.InvitationStatus.REVOKED, expiry),
            (WeddingInvitation.InvitationStatus.ACCEPTED, expiry),
        ):
            with self.subTest(status=status):
                WeddingInvitation.objects.filter(pk=self.invitation.pk).update(
                    status=status, expires_at=expires_at
                )
                preview = APIClient().post(self.preview_url, self.payload, format="json")
                accepted = self.post_as(self.partner)
                self.assertEqual(preview.status_code, 404)
                self.assertEqual(accepted.status_code, 404)
                self.assertEqual(preview.json(), {"detail": "Invitation unavailable."})
        self.assertEqual(self.wedding.memberships.count(), 1)

    def test_missing_invalid_unknown_and_extra_fields_are_rejected(self):
        for case, payload, status in (
            ("missing", {}, 400),
            ("malformed", {"token": "invalid"}, 400),
            ("unknown", {"token": "a" * 43}, 404),
            ("wedding id", {**self.payload, "wedding_id": self.wedding.pk}, 400),
            ("user id", {**self.payload, "user_id": self.partner.pk}, 400),
        ):
            with self.subTest(case=case):
                self.assertEqual(self.post_as(self.partner, payload).status_code, status)
        self.assert_pending()

    def test_failed_membership_creation_leaves_invitation_pending(self):
        with patch("weddings.services.WeddingMembership.objects.create", side_effect=IntegrityError):
            with self.assertRaises(IntegrityError):
                accept_partner_invitation(user=self.partner, token=self.token)
        self.assert_pending()

    def test_failed_invitation_update_rolls_back_membership(self):
        with patch.object(WeddingInvitation, "save", side_effect=IntegrityError):
            with self.assertRaises(IntegrityError):
                accept_partner_invitation(user=self.partner, token=self.token)
        self.assert_pending()


@skipUnlessDBFeature("has_select_for_update")
class ConcurrentInvitationAcceptanceTests(TransactionTestCase):
    def test_invitation_creation_checks_capacity_after_concurrent_acceptance(self):
        owner, partner, stranger = create_participants()
        wedding = create_wedding(user=owner, name="Shared Wedding")
        _, token = create_partner_invitation(wedding=wedding, invited_by=owner, email=partner.email)
        acquiring_lock = Event()

        def record_lock_attempt(execute, sql, params, many, context):
            if "FOR UPDATE" in sql:
                acquiring_lock.set()
            return execute(sql, params, many, context)

        def create_invitation():
            try:
                with connection.execute_wrapper(record_lock_attempt):
                    return create_partner_invitation(wedding=wedding, invited_by=owner, email=stranger.email)
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as executor:
            with transaction.atomic():
                accept_partner_invitation(user=partner, token=token)
                result = executor.submit(create_invitation)
                self.assertTrue(acquiring_lock.wait(timeout=10))
            with self.assertRaisesMessage(ValidationError, "This wedding already has two members."):
                result.result(timeout=10)

        self.assertEqual(wedding.memberships.count(), 2)
        self.assertEqual(wedding.invitations.count(), 1)

    def test_only_one_invitation_can_fill_the_second_membership(self):
        owner, partner, stranger = create_participants()
        wedding = create_wedding(user=owner, name="Shared Wedding")
        participants = (partner, stranger)
        tokens = [
            create_partner_invitation(wedding=wedding, invited_by=owner, email=user.email)[1]
            for user in participants
        ]
        start = Barrier(2, timeout=10)

        def accept(user, token):
            close_old_connections()
            try:
                start.wait()
                accept_partner_invitation(user=user, token=token)
                return True
            except ValidationError:
                return False
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(accept, participants, tokens))

        self.assertCountEqual(results, [True, False])
        self.assertEqual(wedding.memberships.count(), 2)
        self.assertCountEqual(
            wedding.invitations.values_list("status", flat=True),
            [WeddingInvitation.InvitationStatus.ACCEPTED, WeddingInvitation.InvitationStatus.PENDING],
        )
        self.assertEqual(Wedding.objects.count(), 1)
