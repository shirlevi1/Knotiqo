from datetime import date, timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from venues.models import Venue, VenueQuote
from weddings.models import JourneyTask, WeddingMembership
from weddings.services import create_wedding


class JourneyTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        users = get_user_model().objects
        cls.owner = users.create_user(username="journey-owner")
        cls.partner = users.create_user(username="journey-partner")
        cls.outsider = users.create_user(username="journey-outsider")
        cls.wedding = create_wedding(user=cls.owner, name="Shared")
        cls.other = create_wedding(user=cls.outsider, name="Foreign")
        WeddingMembership.objects.create(wedding=cls.wedding, user=cls.partner)

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.base = f"/api/weddings/{self.wedding.pk}/journey/"
        self.login(self.owner)

    def login(self, user):
        self.client.force_login(user)
        self.client.get("/api/auth/csrf/")
        self.csrf = {"HTTP_X_CSRFTOKEN": self.client.cookies["csrftoken"].value}

    def edit(self, key, **values):
        return self.client.patch(self.base + f"tasks/{key}/", values, format="json", **self.csrf)

    def test_defaults_are_stable_progress_is_shared_and_idempotent(self):
        first = self.client.get(self.base).json()
        self.assertEqual(len(first["stages"]), 6)
        self.assertEqual(first, self.client.get(self.base).json())
        self.assertEqual(first["progress"], {"completed": 0, "total": 40, "percentage": 0, "skipped": 0})
        self.assertIsNone(first["recommended_stage"])
        self.assertFalse(JourneyTask.objects.exists())
        for _ in range(2):
            self.assertEqual(self.edit("budget-initial", status="done").status_code, 200)
        self.assertEqual(JourneyTask.objects.count(), 1)
        self.assertEqual(self.edit("guest-estimate", status="skipped").json()["progress"]["total"], 39)
        self.login(self.partner)
        summary = self.client.get(self.base, {"summary": 1}).json()
        self.assertNotIn("stages", summary)
        self.assertEqual(summary["progress"], {"completed": 1, "total": 39, "percentage": 3, "skipped": 1})
        self.assertEqual(self.edit("budget-initial", status="open").json()["progress"]["completed"], 0)
        self.assertEqual(self.edit("guest-estimate", status="open").json()["progress"]["total"], 40)

    def test_custom_tasks_move_change_stage_and_delete_with_validation(self):
        keys = []
        for title in ("First", "Second"):
            response = self.client.post(self.base, {"title": title, "stage": 2}, format="json", **self.csrf)
            self.assertEqual(response.status_code, 201, response.json())
            keys.append(response.json()["stages"][1]["tasks"][-1]["key"])
        order = self.edit(keys[1], move="up").json()["stages"][1]["tasks"]
        self.assertEqual([row["key"] for row in order if row["custom"]], keys[::-1])
        self.assertEqual(self.edit("venue-search", stage=3).status_code, 400)
        self.assertEqual(self.edit(keys[0], status="invalid").status_code, 400)
        self.assertEqual(self.edit(keys[0], stage=7).status_code, 400)
        self.assertEqual(self.edit(keys[0], move="up", status="done").status_code, 400)
        self.assertEqual(self.edit(keys[0], stage=3, description="Note", priority="high").status_code, 200)
        self.assertEqual(JourneyTask.objects.get(key=keys[0]).stage, 3)
        self.assertEqual(self.client.delete(self.base + f"tasks/{keys[0]}/", **self.csrf).status_code, 200)
        self.assertFalse(JourneyTask.objects.filter(key=keys[0]).exists())

    def test_timing_and_evidence_keep_completion_manual(self):
        today = date(2027, 1, 1)
        self.wedding.wedding_date = today + timedelta(days=220)
        self.wedding.save(update_fields=["wedding_date"])
        venue = Venue.objects.create(wedding=self.wedding, name="Venue")
        VenueQuote.objects.create(venue=venue, minimum_guests=1, price_per_guest="20.00")
        with patch("weddings.journey.timezone.localdate", return_value=today):
            first = self.client.get(self.base).json()
            self.assertEqual(first["recommended_stage"], 1)
            comparison = next(task for task in first["stages"][0]["tasks"] if task["key"] == "venue-compare")
            self.assertTrue(comparison["has_evidence"])
            self.assertEqual(comparison["status"], "open")
            venue.status = Venue.Status.BOOKED
            venue.save(update_fields=["status"])
            self.assertEqual(self.client.get(self.base).json()["recommended_stage"], 2)
            self.edit("venue-search", status="done")
            self.edit("rings", due_date="2026-12-31")
            self.wedding.wedding_date = today + timedelta(days=10)
            self.wedding.save(update_fields=["wedding_date"])
            updated = self.client.get(self.base).json()
            self.assertEqual(updated["recommended_stage"], 4)
            self.assertEqual(updated["progress"]["completed"], 1)
            self.assertEqual(updated["next_actions"][0]["key"], "rings")
            self.assertTrue(updated["next_actions"][0]["overdue"])

    def test_wedding_isolation_and_csrf(self):
        created = self.client.post(self.base, {"title": "Private", "stage": 1}, format="json", **self.csrf).json()
        key = created["stages"][0]["tasks"][-1]["key"]
        self.assertEqual(self.client.patch(self.base + f"tasks/{key}/", {"status": "done"}, format="json").status_code, 403)
        self.login(self.outsider)
        self.assertEqual(self.client.get(self.base).status_code, 404)
        foreign = f"/api/weddings/{self.other.pk}/journey/tasks/{key}/"
        self.assertEqual(self.client.patch(foreign, {"status": "done"}, format="json", **self.csrf).status_code, 404)
        self.client.logout()
        self.assertEqual(self.client.get(self.base).status_code, 403)
    def test_visibility_follows_saved_stage_activity_and_explicit_activation(self):
        from weddings.models import BudgetCategory, BudgetExpense, Guest, GuestRSVP, JourneyFeatureActivation, WeddingBudget, WeddingVendor

        def features():
            return self.client.get(self.base + "?summary=1").json()["features"]

        today = date(2027, 1, 1)
        self.wedding.wedding_date = today + timedelta(days=240)
        self.wedding.save(update_fields=["wedding_date"])
        with patch("weddings.journey.timezone.localdate", return_value=today):
            self.assertFalse(any(value["visible"] for value in features().values()))
            venue = Venue.objects.create(wedding=self.wedding, name="Unbooked")
            VenueQuote.objects.create(venue=venue, minimum_guests=1, price_per_guest="20.00")
            self.assertFalse(features()["vendors"]["visible"])
            self.edit("venue-contract", status="done")
            self.assertTrue(features()["payments"]["recommended"])
            self.assertTrue(features()["vendors"]["recommended"])
            self.edit("venue-contract", status="open")
            self.wedding.wedding_date = today + timedelta(days=24)
            self.wedding.save(update_fields=["wedding_date"])
            self.assertTrue(features()["rsvp"]["recommended"])
            self.wedding.wedding_date = today + timedelta(days=240)
            self.wedding.save(update_fields=["wedding_date"])
            self.assertFalse(features()["rsvp"]["visible"])

        WeddingVendor.objects.create(wedding=self.wedding, name="Vendor", service_category="Photography")
        guest = Guest.objects.create(wedding=self.wedding, full_name="Fixture")
        GuestRSVP.objects.create(guest=guest, token_hash="a" * 64)
        self.assertTrue(features()["vendors"]["has_data"])
        self.assertTrue(features()["rsvp"]["has_data"])
        self.assertFalse(features()["payments"]["visible"])
        target = self.base + "features/payments/"
        before = self.client.get(self.base).json()["progress"]
        for _ in range(2):
            self.assertEqual(self.client.post(target, {}, format="json", **self.csrf).status_code, 200)
        self.assertEqual(JourneyFeatureActivation.objects.filter(wedding=self.wedding).count(), 1)
        budget = WeddingBudget.objects.create(wedding=self.wedding)
        category = BudgetCategory.objects.create(budget=budget, name="Venue", planned_amount=0, position=0)
        BudgetExpense.objects.create(category=category, name="Expense", committed_cost=10)
        self.login(self.partner)
        self.assertTrue(features()["payments"]["activated"])
        self.assertTrue(features()["payments"]["has_data"])
        self.assertEqual(self.client.get(self.base).json()["progress"], before)
        self.assertEqual(self.client.post(self.base + "features/seating/", {}, format="json", **self.csrf).status_code, 404)
        self.assertEqual(self.client.post(target, {}, format="json").status_code, 403)
        self.login(self.outsider)
        self.assertEqual(self.client.post(target, {}, format="json", **self.csrf).status_code, 404)
        other = self.client.get(f"/api/weddings/{self.other.pk}/journey/?summary=1").json()
        self.assertFalse(other["features"]["payments"]["visible"])
