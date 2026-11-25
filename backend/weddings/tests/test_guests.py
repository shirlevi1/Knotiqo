from importlib import import_module
from types import SimpleNamespace

from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient

from weddings.models import Guest, WeddingMembership
from weddings.services import create_wedding


class GuestAgeMigrationTests(TransactionTestCase):
    def test_defaults_legacy_ages_idempotently_without_changing_explicit_counts(self):
        before = [("weddings", "0015_journey_feature_activation")]
        after = [("weddings", "0016_guest_adult_defaults")]
        executor = MigrationExecutor(connection)
        try:
            executor.migrate(before)
            old_apps = executor.loader.project_state(before).apps
            wedding = old_apps.get_model("weddings", "Wedding").objects.create(name="Migration fixture")
            guest = old_apps.get_model("weddings", "Guest").objects.create(
                wedding_id=wedding.pk, full_name="Legacy fixture", category="child", party_size=3,
            )
            explicit = old_apps.get_model("weddings", "Guest").objects.create(
                wedding_id=wedding.pk, full_name="Mixed", party_size=4, adult_count=2, child_count=1, infant_count=1,
            )
            rsvp = old_apps.get_model("weddings", "GuestRSVP").objects.create(guest_id=guest.pk,
                                                                            status="attending", attendee_count=2)
            executor = MigrationExecutor(connection)
            executor.migrate(after)
            new_apps = executor.loader.project_state(after).apps
            migrated = new_apps.get_model("weddings", "Guest").objects.get(pk=guest.pk)
            self.assertEqual((migrated.wedding_id, migrated.category, migrated.party_size), (wedding.pk, "child", 3))
            self.assertEqual((migrated.adult_count, migrated.child_count, migrated.infant_count), (3, 0, 0))
            explicit_after = new_apps.get_model("weddings", "Guest").objects.get(pk=explicit.pk)
            self.assertEqual((explicit_after.adult_count, explicit_after.child_count, explicit_after.infant_count), (2, 1, 1))
            response = new_apps.get_model("weddings", "GuestRSVP").objects.get(pk=rsvp.pk)
            self.assertEqual((response.adult_count, response.child_count, response.infant_count), (2, 0, 0))
            migrate_data = import_module("weddings.migrations.0016_guest_adult_defaults").default_legacy_ages
            migrate_data(new_apps, SimpleNamespace(connection=connection))
            explicit_after.refresh_from_db()
            self.assertEqual((explicit_after.adult_count, explicit_after.child_count, explicit_after.infant_count), (2, 1, 1))
        finally:
            executor = MigrationExecutor(connection)
            executor.migrate(executor.loader.graph.leaf_nodes())


class GuestApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        users = get_user_model().objects
        cls.owner = users.create_user(username="guests-owner")
        cls.partner = users.create_user(username="guests-partner")
        cls.outsider = users.create_user(username="guests-outsider")
        cls.wedding = create_wedding(user=cls.owner, name="Shared")
        cls.other = create_wedding(user=cls.outsider, name="Private")
        WeddingMembership.objects.create(wedding=cls.wedding, user=cls.partner)

    def setUp(self):
        self.url = f"/api/weddings/{self.wedding.pk}/guests/"
        self.client = APIClient(enforce_csrf_checks=True)
        self.login(self.owner)

    def login(self, user):
        self.client.force_login(user)
        self.client.get("/api/auth/csrf/")
        self.csrf = {"HTTP_X_CSRFTOKEN": self.client.cookies["csrftoken"].value}

    def test_guest_crud_sharing_and_archive_restore(self):
        create = self.client.post(self.url, {
            "full_name": "נועה לוי", "side": "joint", "party_size": 3, "tags": ["משפחה", "חברים", "משפחה"],
            "family_group": "לוי", "notes": "קרובים",
        }, format="json", **self.csrf)
        self.assertEqual(create.status_code, 201)
        self.assertEqual(create.json()["unnamed_companions"], 2)
        self.assertEqual(create.json()["tags"], ["משפחה", "חברים"])
        detail = f"{self.url}{create.json()['id']}/"
        self.login(self.partner)
        self.assertEqual(self.client.get(detail).json(), create.json())
        self.assertEqual(self.client.patch(detail, {"category": "child"}, format="json", **self.csrf).status_code, 200)
        self.assertEqual(self.client.delete(detail, **self.csrf).status_code, 204)
        self.assertEqual(self.client.delete(detail, **self.csrf).status_code, 204)
        self.assertEqual(self.client.get(self.url).json()["count"], 0)
        archived = self.client.get(self.url, {"archive": "archived"}).json()
        self.assertEqual(archived["count"], 1)
        self.assertTrue(archived["results"][0]["is_archived"])
        restored = self.client.patch(detail, {"is_archived": False}, format="json", **self.csrf)
        self.assertFalse(restored.json()["is_archived"])
        self.assertEqual(restored.json()["category"], "child")
        self.assertEqual(restored.json()["party_size"], 3)

    def test_filters_pagination_and_summary_count_companions_once(self):
        Guest.objects.create(wedding=self.wedding, full_name="דנה לוי", phone="050-1234567", side="bride", party_size=3)
        Guest.objects.create(wedding=self.wedding, full_name="טל כהן", side="groom", category="child", adult_count=0, child_count=1, infant_count=0)
        Guest.objects.create(wedding=self.wedding, full_name="שיר", side="joint", party_size=2)
        Guest.objects.create(wedding=self.wedding, full_name="Archived", is_archived=True, party_size=4)
        Guest.objects.create(wedding=self.other, full_name="Outside", party_size=9)
        first = self.client.get(self.url, {"page_size": 1}).json()
        self.assertEqual((first["count"], len(first["results"])), (3, 1))
        self.assertIsNotNone(first["next"])
        self.assertEqual(first["summary"], {
            "records": 3, "attendees": 6, "unnamed_companions": 3,
            "adult_count": 5, "child_count": 1, "infant_count": 0, "unclassified_count": 0,
            "bride": 3, "groom": 1, "joint": 2, "unassigned": 0,
        })
        for filters, expected in (
            ({"search": "לוי"}, "דנה לוי"), ({"search": "1234567"}, "דנה לוי"),
            ({"side": "bride"}, "דנה לוי"), ({"category": "child"}, "טל כהן"),
        ):
            result = self.client.get(self.url, filters).json()
            self.assertEqual([guest["full_name"] for guest in result["results"]], [expected])
            self.assertEqual(result["summary"]["records"], 1)
        self.assertEqual(self.client.get(self.url, {"archive": "all"}).json()["summary"]["attendees"], 10)
        self.assertEqual(self.client.get(self.url, {"archive": "invalid"}).status_code, 400)

    def test_mixed_ages_derive_totals_and_legacy_category_does_not_classify_attendees(self):
        Guest.objects.create(wedding=self.wedding, full_name="Legacy synthetic", category="adult", party_size=4)
        response = self.client.post(self.url, {
            "full_name": "Mixed synthetic", "adult_count": 2, "child_count": 1, "infant_count": 1,
        }, format="json", **self.csrf)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual((response.data["party_size"], response.data["unnamed_companions"],
                          response.data["unclassified_count"]), (4, 3, 0))
        summary = self.client.get(self.url).json()["summary"]
        self.assertEqual([summary[key] for key in ("adult_count", "child_count", "infant_count", "unclassified_count", "attendees")],
                         [6, 1, 1, 0, 8])
        self.assertEqual(self.client.get(self.url, {"category": "infant"}).json()["count"], 1)
        detail = f"{self.url}{response.data['id']}/"
        for values in (
            {"party_size": 3}, {"party_size": 1, "infant_count": 2}, {"adult_count": None, "child_count": 0, "infant_count": 0},
            {"adult_count": -1, "child_count": 1, "infant_count": 1},
            {"adult_count": 0, "child_count": 0, "infant_count": 0},
            {"adult_count": 1, "child_count": 0, "infant_count": 0, "party_size": 2},
            {"adult_count": 2147483647, "child_count": 1, "infant_count": 0},
        ):
            self.assertEqual(self.client.patch(detail, values, format="json", **self.csrf).status_code, 400)
        self.assertEqual(self.client.patch(detail, {
            "adult_count": 1, "child_count": 1, "infant_count": 0,
        }, format="json", **self.csrf).json()["party_size"], 2)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Guest.objects.create(wedding=self.wedding, full_name="Mismatched counts", adult_count=2,
                                 child_count=0, infant_count=0, party_size=1)

    def test_validation_and_ownership_fields(self):
        for invalid in (
            {"full_name": " "}, {"party_size": 0}, {"party_size": 1.5},
            {"phone": "not a phone"}, {"email": "invalid"}, {"side": "owner"},
            {"category": "other"}, {"tags": [""]}, {"wedding_id": self.other.pk},
            {"wedding": self.other.pk}, {"unnamed_companions": 2},
        ):
            with self.subTest(invalid=invalid):
                response = self.client.post(self.url, {"full_name": "Name", **invalid}, format="json", **self.csrf)
                self.assertEqual(response.status_code, 400)
        self.assertFalse(Guest.objects.exists())
        with self.assertRaises(IntegrityError), transaction.atomic():
            Guest.objects.create(wedding=self.wedding, full_name="Bad", party_size=0)

    def test_csrf_and_wedding_isolation(self):
        guest = Guest.objects.create(wedding=self.wedding, full_name="Shared guest")
        foreign = Guest.objects.create(wedding=self.other, full_name="Private guest")
        detail = f"{self.url}{guest.pk}/"
        self.assertEqual(self.client.post(self.url, {"full_name": "Name"}, format="json").status_code, 403)
        self.assertEqual(self.client.patch(detail, {}, format="json").status_code, 403)
        self.assertEqual(self.client.delete(detail).status_code, 403)
        for url in (f"{self.url}{foreign.pk}/", f"{self.url}0/"):
            for method in ("get", "patch", "delete"):
                response = getattr(self.client, method)(url, **self.csrf)
                self.assertEqual((response.status_code, response.json()), (404, {"detail": "Not found."}))
        self.login(self.outsider)
        for url in (self.url, "/api/weddings/0/guests/"):
            self.assertEqual(self.client.get(url).json(), {"detail": "Not found."})
            self.assertEqual(self.client.post(url, {"full_name": "Name"}, format="json", **self.csrf).status_code, 404)
        self.client.logout()
        self.assertEqual(self.client.get(self.url).status_code, 403)

    def test_default_and_derived_adults_are_shared_and_unrelated_edits_preserve_counts(self):
        for counts, expected in (({"party_size": 4}, (4, 0, 0)), ({"party_size": 4, "child_count": 1, "infant_count": 1}, (2, 1, 1))):
            response = self.client.post(self.url, {"full_name": "Fixture", **counts}, format="json", **self.csrf)
            self.assertEqual(response.status_code, 201, response.json())
            detail = f"{self.url}{response.json()['id']}/"
            self.login(self.partner)
            updated = self.client.patch(detail, {"notes": "Changed"}, format="json", **self.csrf).json()
            self.assertEqual(tuple(updated[field] for field in ("adult_count", "child_count", "infant_count")), expected)
            self.login(self.owner)
