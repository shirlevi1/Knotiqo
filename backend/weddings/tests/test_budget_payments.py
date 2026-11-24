from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from venues.models import Venue
from weddings.models import WeddingMembership
from weddings.services import create_wedding


class PaymentTrackingTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        users = get_user_model().objects
        cls.owner = users.create_user(username="payment-owner")
        cls.partner = users.create_user(username="payment-partner")
        cls.other = users.create_user(username="payment-outsider")
        cls.wedding = create_wedding(user=cls.owner, name="Shared wedding")
        cls.foreign = create_wedding(user=cls.other, name="Private wedding")
        WeddingMembership.objects.create(wedding=cls.wedding, user=cls.partner)
        cls.venue = Venue.objects.create(wedding=cls.wedding, name="Venue")
        cls.foreign_venue = Venue.objects.create(wedding=cls.foreign, name="Private venue")

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.login(self.owner)
        self.base = f"/api/weddings/{self.wedding.pk}/budget/"
        self.expenses = self.base + "expenses/"
        result = self.post(self.base + "categories/", {"name": "Venue", "planned_amount": "1200.00"})
        self.category_id = result.json()["categories"][0]["id"]
        self.today = timezone.localdate()
        self.yesterday = (self.today - timedelta(days=1)).isoformat()
        self.tomorrow = (self.today + timedelta(days=1)).isoformat()

    def login(self, user):
        self.client.force_login(user)
        self.client.get("/api/auth/csrf/")
        self.csrf = {"HTTP_X_CSRFTOKEN": self.client.cookies["csrftoken"].value}

    def post(self, path, data):
        return self.client.post(path, data, format="json", **self.csrf)

    def patch(self, path, data):
        return self.client.patch(path, data, format="json", **self.csrf)

    def expense(self, **changes):
        return self.post(self.expenses, {
            "category_id": self.category_id, "name": "Reception", "committed_cost": "1000.50",
            "venue_id": self.venue.pk, **changes,
        })

    def test_partial_schedule_overdue_multiple_payments_and_correction_shared_with_partner(self):
        created = self.expense()
        self.assertEqual(created.status_code, 201, created.json())
        expense = created.json()["expenses"][0]
        self.assertEqual(expense["schedule_status"], "incomplete")
        self.assertEqual(expense["schedule_difference"], "1000.50")
        self.assertEqual(expense["venue_name"], "Venue")
        path = f"{self.expenses}{expense['id']}/payments/"
        first = self.post(path, {"phase": "deposit", "amount": "350.50", "due_date": self.yesterday})
        self.assertEqual(first.status_code, 201, first.json())
        deposit = first.json()["expenses"][0]["payments"][0]
        self.assertEqual(deposit["timing"], "overdue")
        self.assertEqual(first.json()["totals"]["paid_amount"], "0.00")
        second = self.post(path, {"phase": "on_day", "amount": "600.00", "due_date": self.tomorrow})
        self.assertEqual(second.json()["totals"]["upcoming_amount"], "600.00")
        third = self.post(path, {"phase": "after", "amount": "75.00"})
        self.assertEqual(third.json()["expenses"][0]["schedule_status"], "overallocated")
        self.assertEqual(third.json()["expenses"][0]["schedule_difference"], "-25.00")
        undated = next(p for p in third.json()["expenses"][0]["payments"] if p["phase"] == "after")
        self.assertIsNone(undated["due_date"])
        self.assertIsNone(undated["timing"])

        self.login(self.partner)
        detail = f"{path}{deposit['id']}/"
        partial = self.patch(detail, {"paid_amount": "100.25", "paid_date": self.yesterday})
        self.assertEqual(partial.status_code, 200, partial.json())
        self.assertEqual(partial.json()["expenses"][0]["payments"][0]["status"], "partial")
        self.assertEqual(partial.json()["totals"]["overdue_amount"], "250.25")
        for _ in range(2):
            corrected = self.patch(detail, {"paid_amount": "350.50", "paid_date": self.yesterday})
            self.assertEqual(corrected.status_code, 200)
            self.assertEqual(corrected.json()["totals"]["paid_amount"], "350.50")
        self.login(self.owner)
        shared = self.client.get(self.expenses).json()
        self.assertEqual(shared["totals"]["remaining_amount"], "650.00")
        self.assertEqual(shared["totals"]["overdue_amount"], "0.00")
        self.assertEqual(shared["expenses"][0]["payments"][0]["status"], "paid")
        self.assertEqual(self.client.delete(detail, **self.csrf).status_code, 400)
        self.assertEqual(self.client.delete(f"{self.base}categories/{self.category_id}/", **self.csrf).status_code, 400)

    def test_bounds_and_validation_keep_paid_balances_consistent(self):
        expense = self.expense(committed_cost="10.00").json()["expenses"][0]
        expense_url = f"{self.expenses}{expense['id']}/"
        path = expense_url + "payments/"
        for fields in (
            {"amount": "0"}, {"phase": "broken"}, {"paid_amount": "1"}, {"paid_date": self.yesterday},
            {"paid_amount": "1", "paid_date": self.tomorrow}, {"paid_amount": "11", "paid_date": self.yesterday},
        ):
            self.assertEqual(self.post(path, {"phase": "deposit", "amount": "10", **fields}).status_code, 400)
        paid = self.post(path, {"phase": "deposit", "amount": "8", "paid_amount": "8", "paid_date": self.yesterday})
        self.assertEqual(paid.status_code, 201)
        payment_id = paid.json()["expenses"][0]["payments"][0]["id"]
        self.assertEqual(self.post(path, {
            "phase": "before", "amount": "3", "paid_amount": "3", "paid_date": self.yesterday,
        }).status_code, 400)
        self.assertEqual(self.patch(expense_url, {"committed_cost": "7.99"}).status_code, 400)
        self.assertEqual(self.patch(f"{path}{payment_id}/", {"amount": "7.99"}).status_code, 400)
        self.assertEqual(self.client.delete(expense_url, **self.csrf).status_code, 400)
        corrected = self.patch(f"{path}{payment_id}/", {"paid_amount": "0", "paid_date": None})
        self.assertEqual(corrected.json()["totals"]["paid_amount"], "0.00")
        self.assertEqual(self.client.delete(f"{path}{payment_id}/", **self.csrf).status_code, 200)
        self.assertEqual(self.client.delete(expense_url, **self.csrf).status_code, 200)

    def test_membership_csrf_and_cross_wedding_resource_ids(self):
        self.assertEqual(self.expense(venue_id=self.foreign_venue.pk).status_code, 404)
        self.assertEqual(self.expense(category_id=999999).status_code, 404)
        expense = self.expense().json()["expenses"][0]
        expense_url = f"{self.expenses}{expense['id']}/"
        self.assertEqual(self.client.patch(expense_url, {"name": "Forged"}, format="json").status_code, 403)
        self.login(self.other)
        self.assertEqual(self.client.get(self.expenses).status_code, 404)
        self.assertEqual(self.post(expense_url + "payments/", {"phase": "deposit", "amount": "1"}).status_code, 404)
        self.assertEqual(self.patch(f"/api/weddings/{self.foreign.pk}/budget/expenses/{expense['id']}/",
                                    {"name": "Foreign"}).status_code, 404)
        self.client.logout()
        self.assertEqual(self.client.get(self.expenses).status_code, 403)
