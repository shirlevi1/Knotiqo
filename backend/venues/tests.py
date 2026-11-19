from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.test import TestCase
from rest_framework.test import APIClient

from weddings.models import WeddingMembership
from weddings.services import create_wedding
from .models import Venue, VenueQuote


class VenueAPITests(TestCase):
    @classmethod
    def setUpTestData(cls):
        users = get_user_model().objects
        cls.owner = users.create_user(username="venue-owner")
        cls.partner = users.create_user(username="venue-partner")
        cls.other = users.create_user(username="venue-other")
        cls.wedding = create_wedding(user=cls.owner, name="Shared")
        WeddingMembership.objects.create(wedding=cls.wedding, user=cls.partner)
        cls.other_wedding = create_wedding(user=cls.other, name="Private")
        cls.venue = Venue.objects.create(wedding=cls.wedding, name="Venue")
        cls.foreign = Venue.objects.create(wedding=cls.other_wedding, name="Private venue")
        cls.quote = VenueQuote.objects.create(venue=cls.venue, price_per_guest="350.10", minimum_guests=200)
        cls.foreign_quote = VenueQuote.objects.create(venue=cls.foreign, price_per_guest="400.00", minimum_guests=100)

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.login(self.owner)
        self.base = f"/api/weddings/{self.wedding.pk}/venues/"
        self.detail = f"{self.base}{self.venue.pk}/"
        self.quotes = f"{self.detail}quotes/"
        self.quote_detail = f"{self.quotes}{self.quote.pk}/"
        self.quote_payload = {"price_per_guest": "351.23", "minimum_guests": 201, "additional_costs": "1000.09"}

    def login(self, user):
        self.client.force_login(user)
        self.client.get("/api/auth/csrf/")
        self.headers = {"HTTP_X_CSRFTOKEN": self.client.cookies["csrftoken"].value}

    def write(self, method, url, payload=None):
        return getattr(self.client, method)(url, payload, format="json", **self.headers)

    def test_venue_crud(self):
        response = self.write("post", self.base, {"name": "New venue", "capacity": None})
        self.assertEqual(response.status_code, 201)
        venue = Venue.objects.get(pk=response.data["id"])
        self.assertEqual(venue.wedding_id, self.wedding.pk)
        self.assertEqual(response.data["status"], "interested")
        url = f"{self.base}{venue.pk}/"
        self.assertEqual(self.client.get(url).status_code, 200)
        response = self.write("patch", url, {"capacity": 250, "status": "booked", "is_favorite": True})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["capacity"], 250)
        self.assertTrue(response.data["is_favorite"])
        self.assertEqual(self.write("delete", url).status_code, 204)
        self.assertFalse(Venue.objects.filter(pk=venue.pk).exists())

    def test_quote_crud_multiple_quotes_and_exact_decimals(self):
        response = self.write("post", self.quotes, self.quote_payload)
        self.assertEqual(response.status_code, 201)
        quote = VenueQuote.objects.get(pk=response.data["id"])
        self.assertEqual(quote.venue_id, self.venue.pk)
        self.assertEqual(quote.price_per_guest, Decimal("351.23"))
        self.assertEqual(response.data["additional_costs"], "1000.09")
        self.assertIsNone(response.data["event_date"])
        self.assertEqual(len(self.client.get(self.quotes).data), 2)
        url = f"{self.quotes}{quote.pk}/"
        response = self.write("patch", url, {"price_per_guest": "0.01", "event_date": "2027-06-15"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["price_per_guest"], "0.01")
        self.assertEqual(response.data["event_date"], "2027-06-15")
        self.assertEqual(self.write("delete", url).status_code, 204)
        self.assertTrue(VenueQuote.objects.filter(pk=self.quote.pk).exists())

    def test_both_members_share_and_edit_resources(self):
        for user in (self.owner, self.partner):
            self.login(user)
            for url in (self.base, self.detail, self.quotes, self.quote_detail):
                self.assertEqual(self.client.get(url).status_code, 200)
            self.assertEqual(self.write("patch", self.detail, {"notes": "Shared"}).status_code, 200)
            self.assertEqual(self.write("patch", self.quote_detail, {"notes": "Shared"}).status_code, 200)

    def test_anonymous_and_csrf_rejection_for_all_writes(self):
        operations = (
            ("post", self.base, {"name": "New"}),
            ("patch", self.detail, {"name": "Changed"}),
            ("delete", self.detail, None),
            ("post", self.quotes, self.quote_payload),
            ("patch", self.quote_detail, {"notes": "Changed"}),
            ("delete", self.quote_detail, None),
        )
        for headers in ({}, {"HTTP_X_CSRFTOKEN": "invalid"}):
            for method, url, payload in operations:
                with self.subTest(method=method, url=url, headers=headers):
                    self.assertEqual(getattr(self.client, method)(url, payload, format="json", **headers).status_code, 403)
        self.client.logout()
        for url in (self.base, self.detail, self.quotes, self.quote_detail):
            self.assertEqual(self.client.get(url).status_code, 403)
        for method, url, payload in operations:
            self.assertEqual(self.write(method, url, payload).status_code, 403)

    def test_nonmember_cross_wedding_and_missing_resources_have_identical_404(self):
        foreign_base = f"/api/weddings/{self.other_wedding.pk}/venues/"
        foreign_detail = f"{foreign_base}{self.foreign.pk}/"
        second_venue = Venue.objects.create(wedding=self.wedding, name="Second")
        cases = [
            (foreign_base, ("get", "post")),
            (foreign_detail, ("get", "patch", "delete")),
            (f"{foreign_detail}quotes/", ("get", "post")),
            (f"{foreign_detail}quotes/{self.foreign_quote.pk}/", ("get", "patch", "delete")),
            (f"{self.base}{self.foreign.pk}/", ("get", "patch", "delete")),
            (f"{self.base}{self.foreign.pk}/quotes/", ("get", "post")),
            (f"{self.quotes}{self.foreign_quote.pk}/", ("get", "patch", "delete")),
            (f"{self.base}{second_venue.pk}/quotes/{self.quote.pk}/", ("get", "patch", "delete")),
            ("/api/weddings/0/venues/", ("get", "post")),
            (f"{self.base}0/", ("get", "patch", "delete")),
            (f"{self.base}0/quotes/", ("get", "post")),
            (f"{self.quotes}0/", ("get", "patch", "delete")),
        ]
        for url, methods in cases:
            for method in methods:
                with self.subTest(url=url, method=method):
                    response = self.client.get(url) if method == "get" else self.write(method, url, {})
                    self.assertEqual(response.status_code, 404)
                    self.assertEqual(response.json(), {"detail": "Not found."})

    def test_ownership_ids_and_timestamps_cannot_be_assigned(self):
        for url, payload in ((self.base, {"name": "New"}), (self.quotes, self.quote_payload)):
            for field in ("id", "wedding", "wedding_id", "venue", "venue_id", "created_at", "updated_at"):
                with self.subTest(url=url, field=field):
                    self.assertEqual(self.write("post", url, {**payload, field: 999}).status_code, 400)
        for url in (self.detail, self.quote_detail):
            for field in ("id", "wedding", "wedding_id", "venue", "venue_id", "created_at", "updated_at"):
                self.assertEqual(self.write("patch", url, {field: 999}).status_code, 400)
        self.venue.refresh_from_db()
        self.quote.refresh_from_db()
        self.assertEqual(self.venue.wedding_id, self.wedding.pk)
        self.assertEqual(self.quote.venue_id, self.venue.pk)

    def test_invalid_fields_are_rejected_on_create_and_patch(self):
        for field, value in (("price_per_guest", "-0.01"), ("additional_costs", "-1"), ("minimum_guests", 0),
                             ("minimum_guests", 1.5), ("price_per_guest", "0.001"), ("price_per_guest", "NaN")):
            self.assertEqual(self.write("post", self.quotes, {**self.quote_payload, field: value}).status_code, 400)
            self.assertEqual(self.write("patch", self.quote_detail, {field: value}).status_code, 400)
        for field, value in (("capacity", 0), ("capacity", -1), ("capacity", 1.5), ("status", "unknown")):
            self.assertEqual(self.write("post", self.base, {"name": "New", field: value}).status_code, 400)
            self.assertEqual(self.write("patch", self.detail, {field: value}).status_code, 400)

    def test_database_constraints(self):
        for changes in ({"price_per_guest": "-0.01"}, {"additional_costs": "-0.01"}, {"minimum_guests": 0}):
            with self.assertRaises(IntegrityError), transaction.atomic():
                VenueQuote.objects.filter(pk=self.quote.pk).update(**changes)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Venue.objects.filter(pk=self.venue.pk).update(capacity=0)

    def test_deleting_venue_cascades_to_its_quotes_only(self):
        VenueQuote.objects.create(venue=self.venue, price_per_guest="0", minimum_guests=1)
        self.assertEqual(self.write("delete", self.detail).status_code, 204)
        self.assertFalse(VenueQuote.objects.filter(venue_id=self.venue.pk).exists())
        self.assertTrue(Venue.objects.filter(pk=self.foreign.pk).exists())
        self.assertTrue(VenueQuote.objects.filter(pk=self.foreign_quote.pk).exists())
