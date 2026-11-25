from datetime import UTC, datetime
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from venues.models import Venue, VenueImage
from weddings.models import WeddingMeeting, WeddingMembership, WeddingVendor
from weddings.services import create_wedding


class MeetingTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        users = get_user_model().objects
        cls.owner = users.create_user(username="meeting-owner")
        cls.partner = users.create_user(username="meeting-partner")
        cls.outsider = users.create_user(username="meeting-outsider")
        cls.wedding = create_wedding(user=cls.owner, name="Shared")
        cls.other = create_wedding(user=cls.outsider, name="Foreign")
        WeddingMembership.objects.create(wedding=cls.wedding, user=cls.partner)
        cls.venue = Venue.objects.create(wedding=cls.wedding, name="Venue")
        cls.vendor = WeddingVendor.objects.create(wedding=cls.wedding, name="Vendor", service_category="Photography")
        cls.foreign_venue = Venue.objects.create(wedding=cls.other, name="Private")
        cls.foreign_vendor = WeddingVendor.objects.create(wedding=cls.other, name="Private", service_category="Photography")

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.url = f"/api/weddings/{self.wedding.pk}/meetings/"
        self.login(self.owner)

    def login(self, user):
        self.client.force_login(user)
        self.client.get("/api/auth/csrf/")
        self.csrf = {"HTTP_X_CSRFTOKEN": self.client.cookies["csrftoken"].value}

    def create(self, **values):
        return self.client.post(self.url, {"title": "Meeting", "meeting_type": "venue_tour", "date": "2027-07-01",
                                          "start_time": "00:30", **values}, format="json", **self.csrf)

    def test_crud_partners_timezone_and_scoped_filters(self):
        result = self.create(venue_id=self.venue.pk, end_time="01:15", contact_person="Contact",
                             phone="0501234567", location="Venue address", notes="Meeting notes")
        self.assertEqual(result.status_code, 201, result.json())
        meeting = result.json()
        self.assertEqual(meeting["date"], "2027-07-01")
        self.assertEqual(meeting["start_time"], "00:30")
        self.assertEqual(meeting["starts_at"], "2027-06-30T21:30:00Z")
        self.assertEqual(WeddingMeeting.objects.get(pk=meeting["id"]).starts_at,
                         datetime(2027, 6, 30, 21, 30, tzinfo=UTC))
        self.assertEqual(meeting["venue_name"], "Venue")
        self.assertIsNone(meeting["vendor_name"])
        self.login(self.partner)
        self.assertEqual(self.client.get(self.url, {"date_from": "2027-07-01", "date_to": "2027-07-01",
                                                    "venue_id": self.venue.pk}).json()["count"], 1)
        self.assertEqual(self.client.get(self.url, {"date_to": "2027-06-30"}).json()["count"], 0)
        self.assertEqual(self.client.get(self.url + "dates/", {"date_from": "2027-06-01", "date_to": "2027-07-31"}).json(),
                         ["2027-07-01"])
        detail = self.url + f"{meeting['id']}/"
        updated = self.client.patch(detail, {"venue_id": None, "vendor_id": self.vendor.pk, "date": "2027-01-01",
                                             "status": "completed"}, format="json", **self.csrf)
        self.assertEqual(updated.status_code, 200, updated.json())
        self.assertEqual(updated.json()["starts_at"], "2026-12-31T22:30:00Z")
        self.assertEqual(updated.json()["vendor_name"], "Vendor")
        self.assertEqual(self.client.get(self.url, {"vendor_id": self.vendor.pk, "status": "completed",
                                                    "meeting_type": "venue_tour"}).json()["count"], 1)
        self.assertEqual(self.client.get(self.url, {"status": "scheduled"}).json()["count"], 0)
        self.assertEqual(self.client.delete(detail, **self.csrf).status_code, 204)
        self.assertEqual(self.client.get(detail).status_code, 404)

    def test_validation_and_daylight_saving_transitions(self):
        for overrides in (
            {"title": ""}, {"meeting_type": "invalid"}, {"date": "2027-02-29"}, {"start_time": "26:00"},
            {"end_time": "00:25"}, {"phone": "invalid"}, {"video_url": "ftp://example.com/"},
            {"venue_id": self.venue.pk, "vendor_id": self.vendor.pk},
            {"date": "2026-03-27", "start_time": "02:30"},
            {"date": "2026-10-25", "start_time": "01:30"},
        ):
            with self.subTest(overrides=overrides):
                self.assertEqual(self.create(**overrides).status_code, 400)
        self.assertEqual(self.create(video_url="https://example.com/video", meeting_type="video").status_code, 201)
        self.assertEqual(self.client.get(self.url, {"date_from": "2027-04-01", "date_to": "2027-03-01"}).status_code, 400)

    def test_isolation_auth_csrf_and_upcoming(self):
        self.assertEqual(self.create(venue_id=self.foreign_venue.pk).status_code, 404)
        self.assertEqual(self.create(vendor_id=self.foreign_vendor.pk).status_code, 404)
        first = self.create(venue_id=self.venue.pk).json()["id"]
        self.create(venue_id=self.venue.pk, start_time="09:00")
        self.create(vendor_id=self.vendor.pk, status="cancelled")
        with patch("weddings.meetings.now", return_value=datetime(2027, 1, 1, tzinfo=UTC)):
            response = self.client.get(self.url + "upcoming/")
            self.assertEqual(response.status_code, 200, response.json())
            dashboard = response.json()
            self.assertEqual(len(dashboard), 2)
            self.assertEqual([item["id"] for item in self.client.get(self.url + "upcoming/", {"scope": "venues"}).json()],
                             [first])
            self.assertEqual(self.client.get(self.url + "upcoming/", {"scope": "vendors"}).json(), [])
        self.assertEqual({item["name"] for item in self.client.get(self.url + "options/").json()}, {"Venue", "Vendor"})
        self.assertEqual(self.client.patch(self.url + f"{first}/", {"status": "cancelled"}, format="json").status_code, 403)
        self.login(self.outsider)
        self.assertEqual(self.client.get(self.url).status_code, 404)
        other_url = f"/api/weddings/{self.other.pk}/meetings/{first}/"
        self.assertEqual(self.client.get(other_url).status_code, 404)
        self.assertEqual(self.client.delete(other_url, **self.csrf).status_code, 404)
        self.client.logout()
        self.assertEqual(self.client.get(self.url).status_code, 403)

    def test_dashboard_filters_and_primary_image_are_scoped(self):
        self.venue.location = "Saved address"
        self.venue.save(update_fields=["location"])
        VenueImage.objects.create(venue=self.venue, image_url="https://example.com/secondary.jpg", sort_order=1)
        VenueImage.objects.create(venue=self.venue, image_url="https://example.com/primary.jpg", is_primary=True)
        meeting = self.create(venue_id=self.venue.pk, title="Tour", location="Meeting address",
                              contact_person="Meeting contact").json()
        self.create(vendor_id=self.vendor.pk, title="Vendor history", status="completed")
        self.create(title="Cancelled", status="cancelled")
        self.login(self.partner)
        params = {"upcoming": "true", "association": "venue", "search": "tour", "summary": "1"}
        with patch("weddings.meetings.now", return_value=datetime(2027, 1, 1, tzinfo=UTC)):
            summary = self.client.get(self.url, params).json()
            self.assertEqual(summary["count"], 1)
            self.assertEqual(self.client.get(self.url, {"upcoming": "true"}).json()["count"], 1)
        first = summary["first"]
        self.assertEqual(first["id"], meeting["id"])
        self.assertEqual(first["location"], "Meeting address")
        self.assertEqual(first["contact_person"], "Meeting contact")
        self.assertEqual(first["venue_details"]["location"], "Saved address")
        self.assertEqual(first["venue_details"]["image_url"], "https://example.com/primary.jpg")
        self.assertEqual(self.client.get(self.url, {"status": "completed", "association": "vendor"}).json()["count"], 1)
        self.assertEqual(self.client.get(self.url, {"status": "cancelled", "association": "general"}).json()["count"], 1)
        self.login(self.outsider)
        self.assertEqual(self.client.get(self.url, params).status_code, 404)
