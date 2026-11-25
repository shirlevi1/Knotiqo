from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from venues.models import Venue, VenueQuote

from weddings.models import Guest, WeddingBudget, WeddingMembership
from weddings.services import create_wedding


class BudgetTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        users = get_user_model().objects
        cls.owner = users.create_user(username="budget-owner")
        cls.partner = users.create_user(username="budget-partner")
        cls.outsider = users.create_user(username="budget-outsider")
        cls.wedding = create_wedding(user=cls.owner, name="Shared")
        cls.other = create_wedding(user=cls.outsider, name="Other")
        WeddingMembership.objects.create(user=cls.partner, wedding=cls.wedding)
        venue = Venue.objects.create(wedding=cls.wedding, name="Local venue")
        other_venue = Venue.objects.create(wedding=cls.other, name="Other venue")
        cls.quote = VenueQuote.objects.create(venue=venue, price_per_guest="100.10", minimum_guests=3, additional_costs="0.05")
        cls.foreign = VenueQuote.objects.create(venue=other_venue, price_per_guest="9", minimum_guests=1)

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.base = f"/api/weddings/{self.wedding.pk}/budget/"
        self.login(self.owner)

    def login(self, user):
        self.client.force_login(user)
        self.client.get("/api/auth/csrf/")
        self.csrf = {"HTTP_X_CSRFTOKEN": self.client.cookies["csrftoken"].value}

    def create(self, name, planned, estimated=None, base=None):
        return self.client.post((base or self.base) + "categories/", {
            "name": name, "planned_amount": planned, "estimated_cost": estimated,
        }, format="json", **self.csrf)

    def test_empty_and_shared_exact_totals_order_edit_and_delete(self):
        empty = self.client.get(self.base).json()
        self.assertEqual(empty["total_budget"], "0.00")
        self.assertEqual(empty["categories"], [])
        self.assertFalse(WeddingBudget.objects.exists())
        response = self.client.patch(self.base, {"total_budget": "1.50"}, format="json", **self.csrf)
        self.assertEqual(response.status_code, 200)
        response = self.create("Venue", "1.01", "2.09")
        self.assertEqual(response.status_code, 201)
        first = response.json()["categories"][0]["id"]
        response = self.create("Photo", "0.50")
        second = response.json()["categories"][1]["id"]
        self.login(self.partner)
        summary = self.client.get(self.base).json()
        self.assertEqual(summary["currency"], "ILS")
        self.assertEqual(summary["allocated_budget"], "1.51")
        self.assertEqual(summary["estimated_spending"], "2.09")
        self.assertEqual(summary["unallocated_budget"], "-0.01")
        self.assertEqual(summary["estimated_remaining_budget"], "-0.59")
        self.assertEqual(summary["missing_estimate_count"], 1)
        for ids in ([first], [first, first], [second, 999999]):
            response = self.client.patch(self.base, {"category_ids": ids, "total_budget": "99"}, format="json", **self.csrf)
            self.assertEqual(response.status_code, 400)
        response = self.client.patch(self.base, {"category_ids": [second, first]}, format="json", **self.csrf)
        self.assertEqual([item["id"] for item in response.json()["categories"]], [second, first])
        detail = f"{self.base}categories/{first}/"
        response = self.client.patch(detail, {"estimated_cost": None, "name": "Reception"}, format="json", **self.csrf)
        self.assertEqual(response.json()["categories"][1]["name"], "Reception")
        self.assertEqual(response.json()["estimated_spending"], "0.00")
        response = self.client.delete(f"{self.base}categories/{second}/", **self.csrf)
        self.assertEqual(response.json()["categories"][0]["position"], 0)
        self.login(self.owner)
        self.assertEqual(self.client.get(self.base).json()["total_budget"], "1.50")

    def test_csrf_membership_and_category_isolation(self):
        self.assertEqual(self.client.patch(self.base, {"total_budget": "3.00"}, format="json").status_code, 403)
        self.login(self.outsider)
        self.assertEqual(self.client.get(self.base).status_code, 404)
        self.assertEqual(self.client.patch(self.base, {"bad": 1}, format="json", **self.csrf).status_code, 404)
        result = self.create("Private", "7", base=f"/api/weddings/{self.other.pk}/budget/").json()
        category_id = result["categories"][0]["id"]
        self.login(self.owner)
        url = f"{self.base}categories/{category_id}/"
        self.assertEqual(self.client.patch(url, {"name": "New"}, format="json", **self.csrf).status_code, 404)
        self.assertEqual(self.client.delete(url, **self.csrf).status_code, 404)
        self.client.logout()
        self.assertEqual(self.client.get(self.base).status_code, 403)

    def test_rejects_invalid_money_and_unexpected_fields(self):
        for invalid in (-1, 0.25, True, "-1", ".25", "NaN", "1.002", "1e2", "10000000000", None):
            with self.subTest(value=invalid):
                self.assertEqual(self.client.patch(
                    self.base, {"total_budget": invalid}, format="json", **self.csrf,
                ).status_code, 400)
                self.assertEqual(self.create("Venue", invalid).status_code, 400)
        self.assertEqual(self.create(" ", "1").status_code, 400)
        self.assertEqual(self.create("Venue", "1", "bad").status_code, 400)
        self.assertEqual(self.client.patch(
            self.base, {"total_budget": "20", "wedding_id": self.other.pk}, format="json", **self.csrf,
        ).status_code, 400)
        self.assertFalse(WeddingBudget.objects.exists())

    def test_live_guest_summary_and_read_only_quote_simulation(self):
        Guest.objects.create(wedding=self.wedding, full_name="Mixed group", party_size=4,
                             adult_count=2, child_count=1, infant_count=1)
        Guest.objects.create(wedding=self.wedding, full_name="Legacy group", party_size=3)
        Guest.objects.create(wedding=self.wedding, full_name="Archived", is_archived=True)
        Guest.objects.create(wedding=self.other, full_name="Foreign")
        snapshot = self.client.get(self.base).json()
        self.assertEqual(snapshot["attendee_summary"], {
            "attendees": 7, "adult_count": 5, "child_count": 1, "infant_count": 1, "unclassified_count": 0,
        })
        url = self.base + "venue-simulation/"
        for quote_id, guests, status in ((self.foreign.pk, 2, 404), (self.quote.pk, 0, 400), (self.quote.pk, True, 400)):
            self.assertEqual(self.client.post(url, {"quote_id": quote_id, "expected_guests": guests},
                                             format="json", **self.csrf).status_code, status)
        for guests, billable, cost in ((2, 3, "300.35"), (7, 7, "700.75")):
            response = self.client.post(url, {"quote_id": self.quote.pk, "expected_guests": guests}, format="json", **self.csrf)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["billable_guests"], billable)
            self.assertEqual(response.json()["total_cost"], cost)
        self.assertEqual(self.client.get(self.base).json(), snapshot)
        self.assertFalse(WeddingBudget.objects.exists())
