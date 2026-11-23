from datetime import date
from decimal import localcontext

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from weddings.models import WeddingMembership
from weddings.services import create_wedding
from .models import Venue, VenueQuote
from .services import compare_quotes_for_user


class VenueComparisonTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        users = get_user_model().objects
        cls.owner = users.create_user(username="comparison-owner")
        cls.partner = users.create_user(username="comparison-partner")
        cls.outsider = users.create_user(username="comparison-outsider")
        cls.wedding = create_wedding(user=cls.owner, name="Shared wedding")
        cls.other_wedding = create_wedding(user=cls.outsider, name="Other wedding")
        WeddingMembership.objects.create(wedding=cls.wedding, user=cls.partner)
        cls.venue = Venue.objects.create(wedding=cls.wedding, name="Orchard")
        garden = Venue.objects.create(wedding=cls.wedding, name="Garden")
        other_venue = Venue.objects.create(wedding=cls.other_wedding, name="Private")
        cls.above_minimum = VenueQuote.objects.create(
            venue=garden, price_per_guest="100.25", minimum_guests=250, additional_costs="0.05",
        )
        cls.below_minimum = VenueQuote.objects.create(
            venue=cls.venue, price_per_guest="100.10", minimum_guests=300, additional_costs="12.34",
            event_date=date(2027, 5, 2), notes="Saved quote note",
        )
        cls.equal_minimum = VenueQuote.objects.create(
            venue=cls.venue, price_per_guest="100.25", minimum_guests=280, additional_costs="0.05",
            event_date=date(2027, 5, 3),
        )
        cls.foreign_quote = VenueQuote.objects.create(venue=other_venue, price_per_guest="1.00", minimum_guests=1)

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.login(self.owner)
        self.url = self.endpoint(self.wedding.pk)
        self.payload = {
            "expected_guests": 280,
            "quote_ids": [self.below_minimum.pk, self.equal_minimum.pk, self.above_minimum.pk],
        }

    def login(self, user):
        self.client.force_login(user)
        self.client.get("/api/auth/csrf/")
        self.csrf = {"HTTP_X_CSRFTOKEN": self.client.cookies["csrftoken"].value}

    @staticmethod
    def endpoint(wedding_id):
        return f"/api/weddings/{wedding_id}/venues/compare/"

    def test_calculates_below_equal_and_above_minimum_with_deterministic_tie_break(self):
        response = self.client.post(self.url, self.payload, format="json", **self.csrf)
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["expected_guests"], 280)
        self.assertEqual(result["cheapest_quote_id"], self.above_minimum.pk)
        self.assertEqual(result["cheapest_quote_label"], "Lowest known calculated cost")
        rows = result["comparisons"]
        self.assertEqual([row["quote_id"] for row in rows], [
            self.above_minimum.pk, self.equal_minimum.pk, self.below_minimum.pk,
        ])
        self.assertEqual([row["billable_guests"] for row in rows], [280, 280, 300])
        self.assertEqual([row["minimum_guests"] for row in rows], [250, 280, 300])
        self.assertEqual([row["total_cost"] for row in rows], ["28070.05", "28070.05", "30042.34"])
        self.assertEqual([row["difference_from_cheapest"] for row in rows], ["0.00", "0.00", "1972.29"])
        self.assertEqual([row["event_date"] for row in rows], [None, "2027-05-03", "2027-05-02"])
        self.assertEqual(rows[2], {
            "quote_id": self.below_minimum.pk, "venue_id": self.venue.pk, "venue_name": "Orchard",
            "event_date": "2027-05-02", "price_per_guest": "100.10", "minimum_guests": 300,
            "additional_costs": "12.34", "notes": "Saved quote note", "billable_guests": 300,
            "meals_cost": "30030.00", "total_cost": "30042.34", "difference_from_cheapest": "1972.29",
        })
        self.assertEqual(rows[1]["venue_id"], self.venue.pk)

    def test_exact_arithmetic_independent_of_ambient_precision_and_one_scoped_quote_query(self):
        quote = VenueQuote.objects.create(
            venue=self.venue, price_per_guest="99999999.99", minimum_guests=1, additional_costs="9999999999.99",
        )
        guests = 10**30 + 7
        cents = guests * 9_999_999_999 + 999_999_999_999
        whole, fraction = divmod(cents, 100)
        with localcontext() as context:
            context.prec = 2
            with self.assertNumQueries(1):
                result = compare_quotes_for_user(
                    user=self.owner, wedding_id=self.wedding.pk, expected_guests=guests,
                    quote_ids=[quote.pk, self.above_minimum.pk],
                )
        self.assertEqual(result["comparisons"][1]["total_cost"], f"{whole}.{fraction:02}")

    def test_strict_request_validation_and_malformed_json(self):
        quote_ids = self.payload["quote_ids"]
        invalid = [
            [], {}, {**self.payload, "unexpected": True},
            *[{**self.payload, "expected_guests": value} for value in (0, -1, None, "280", 280.0, True)],
            *[{**self.payload, "quote_ids": value} for value in (
                "1,2", [], [quote_ids[0]], quote_ids + quote_ids[:2], [quote_ids[0]] * 2,
                [quote_ids[0], False], [quote_ids[0], "20"], [quote_ids[0], 1.0],
                [quote_ids[0], 0], [quote_ids[0], 2**63],
            )],
        ]
        for body in invalid:
            with self.subTest(body=body):
                self.assertEqual(self.client.post(self.url, body, format="json", **self.csrf).status_code, 400)
        for body in ('{"quote_ids":', "[" * 1400 + "]" * 1400, " " * 4096 + "{}"):
            response = self.client.post(self.url, body, content_type="application/json", **self.csrf)
            self.assertEqual(response.status_code, 400)

    def test_partner_can_compare_four_quotes_and_request_does_not_write(self):
        fourth = VenueQuote.objects.create(venue=self.venue, price_per_guest="0.00", minimum_guests=1)
        before_venues = list(Venue.objects.order_by("pk").values())
        before_quotes = list(VenueQuote.objects.order_by("pk").values())
        self.login(self.partner)
        response = self.client.post(self.url, {
            **self.payload, "quote_ids": [*self.payload["quote_ids"], fourth.pk],
        }, format="json", **self.csrf)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["cheapest_quote_id"], fourth.pk)
        self.assertEqual(response.json()["comparisons"][0]["total_cost"], "0.00")
        self.assertEqual(list(Venue.objects.order_by("pk").values()), before_venues)
        self.assertEqual(list(VenueQuote.objects.order_by("pk").values()), before_quotes)

    def test_anonymous_and_missing_or_invalid_csrf_are_forbidden(self):
        for headers in ({}, {"HTTP_X_CSRFTOKEN": "invalid"}):
            response = self.client.post(self.url, self.payload, format="json", **headers)
            self.assertEqual(response.status_code, 403)
        self.client.logout()
        self.assertEqual(self.client.post(self.url, self.payload, format="json", **self.csrf).status_code, 403)

    def test_missing_or_foreign_quotes_and_inaccessible_weddings_return_the_same_404(self):
        WeddingMembership.objects.create(wedding=self.other_wedding, user=self.owner)
        for unavailable in (self.foreign_quote.pk, 2**63 - 1):
            response = self.client.post(self.url, {
                **self.payload, "quote_ids": [self.below_minimum.pk, unavailable],
            }, format="json", **self.csrf)
            self.assertEqual(response.status_code, 404)
            self.assertEqual(response.json(), {"detail": "Not found."})

        self.login(self.outsider)
        for url in (self.url, self.endpoint(0)):
            response = self.client.post(url, {"expected_guests": "invalid"}, format="json", **self.csrf)
            self.assertEqual(response.status_code, 404)
            self.assertEqual(response.json(), {"detail": "Not found."})
