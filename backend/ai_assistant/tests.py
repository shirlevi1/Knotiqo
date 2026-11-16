import json
import os
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from weddings.services import create_wedding


class BudgetAnalysisTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        users = get_user_model().objects
        cls.member = users.create_user(username="member")
        cls.nonmember = users.create_user(username="nonmember")
        cls.wedding = create_wedding(user=cls.member, name="Private wedding name")

    def setUp(self):
        self.url = reverse("budget-analysis", args=[self.wedding.pk])
        self.client = APIClient(enforce_csrf_checks=True)
        self.payload = {
            "total_budget": "100.00",
            "guests": 3,
            "price_per_guest": "31.01",
            "other_expenses": "7.00",
        }
        self.enterContext(patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}))
        os.environ.pop("GEMINI_TIMEOUT_SECONDS", None)
        self.provider = self.enterContext(patch("google.genai.Client"))
        self.generate = self.provider.return_value.__enter__.return_value.models.generate_content
        self.generate.return_value = SimpleNamespace(
            text="יש חריגה מהתקציב. בדקו אילו הוצאות אפשר לצמצם.",
            budget_analysis={"remaining_budget": "9999.99"},
        )

    def sign_in(self, user):
        self.client.force_login(user)
        self.client.get("/api/auth/csrf/")
        return {"X-CSRFToken": self.client.cookies["csrftoken"].value}

    def test_member_receives_verified_breakdown_and_recommendation(self):
        self.assertEqual(self.url, f"/api/ai/weddings/{self.wedding.pk}/budget-analysis/")
        headers = self.sign_in(self.member)
        payload = {
            "total_budget": "120000.00",
            "guests": 300,
            "price_per_guest": "350.00",
            "other_expenses": "25000.00",
        }
        response = self.client.post(
            self.url, {**payload, "remaining_budget": "999.99"}, format="json", headers=headers
        )

        breakdown = {
            **payload,
            "venue_cost": "105000.00",
            "total_expenses": "130000.00",
            "remaining_budget": "-10000.00",
            "over_budget": True,
        }
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "budget_analysis": breakdown,
            "ai_recommendation": self.generate.return_value.text,
        })
        self.assertIn("no-store", response.headers["Cache-Control"])
        self.generate.assert_called_once()
        request = self.generate.call_args.kwargs
        self.assertEqual(json.loads(request["contents"].split("\n", 1)[1]), breakdown)
        self.assertTrue(request["config"].automatic_function_calling.disable)
        self.assertIsNone(request["config"].tools)
        self.assertIn("Verified breakdown supplied by Django", request["config"].system_instruction)
        self.assertIn("Hebrew", request["config"].system_instruction)
        http_options = self.provider.call_args.kwargs["http_options"]
        self.assertEqual(http_options.timeout, 30_000)
        self.assertEqual(http_options.retry_options.attempts, 1)

    def test_timeout_can_be_configured_in_seconds(self):
        headers = self.sign_in(self.member)
        with patch.dict(os.environ, {"GEMINI_TIMEOUT_SECONDS": "45"}):
            response = self.client.post(self.url, self.payload, format="json", headers=headers)

        self.assertEqual(response.status_code, 200)
        http_options = self.provider.call_args.kwargs["http_options"]
        self.assertEqual(http_options.timeout, 45_000)

    def test_invalid_timeout_never_reaches_provider(self):
        headers = self.sign_in(self.member)
        for value in ("0", "-1", "invalid"):
            with self.subTest(value=value), patch.dict(os.environ, {"GEMINI_TIMEOUT_SECONDS": value}):
                response = self.client.post(self.url, self.payload, format="json", headers=headers)
                self.assertEqual(response.status_code, 503)
        self.provider.assert_not_called()

    def test_anonymous_request_is_denied(self):
        response = self.client.post(self.url, self.payload, format="json")
        self.assertEqual(response.status_code, 403)
        self.provider.assert_not_called()

    def test_nonmember_and_missing_wedding_return_the_same_error(self):
        headers = self.sign_in(self.nonmember)
        forbidden = self.client.post(self.url, {}, format="json", headers=headers)
        missing_url = reverse("budget-analysis", args=[0])
        missing = self.client.post(missing_url, {}, format="json", headers=headers)
        self.assertEqual(forbidden.status_code, 404)
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(forbidden.json(), missing.json())
        self.provider.assert_not_called()

    def test_session_requires_csrf(self):
        self.sign_in(self.member)
        for headers in ({}, {"X-CSRFToken": "invalid"}):
            response = self.client.post(self.url, self.payload, format="json", headers=headers)
            self.assertEqual(response.status_code, 403)
        self.provider.assert_not_called()

    def test_invalid_input_never_reaches_provider(self):
        headers = self.sign_in(self.member)
        for field, value in (
            ("guests", 0),
            ("guests", 1.5),
            ("price_per_guest", "0.001"),
            ("other_expenses", "-1.00"),
            ("total_budget", "NaN"),
        ):
            with self.subTest(field=field, value=value):
                response = self.client.post(
                    self.url, {**self.payload, field: value}, format="json", headers=headers
                )
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.json())
        self.provider.assert_not_called()

    def test_calculation_remains_exact_beyond_default_decimal_precision(self):
        headers = self.sign_in(self.member)
        response = self.client.post(self.url, {
            "total_budget": "1.00",
            "guests": 10**30 + 1,
            "price_per_guest": "0.01",
            "other_expenses": "0.98",
        }, format="json", headers=headers)

        self.assertEqual(response.status_code, 200)
        result = response.json()["budget_analysis"]
        self.assertEqual(result["venue_cost"], f"{10**28}.01")
        self.assertEqual(result["total_expenses"], f"{10**28}.99")
        self.assertEqual(result["remaining_budget"], f"-{10**28 - 1}.99")

    def test_provider_timeout_returns_generic_503(self):
        headers = self.sign_in(self.member)
        self.generate.side_effect = TimeoutError("Sensitive details from provider")
        response = self.client.post(self.url, self.payload, format="json", headers=headers)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"detail": "Budget recommendation temporarily unavailable."})

    def test_empty_recommendation_returns_503(self):
        headers = self.sign_in(self.member)
        self.generate.return_value = SimpleNamespace(text=" ")
        response = self.client.post(self.url, self.payload, format="json", headers=headers)
        self.assertEqual(response.status_code, 503)

    def test_missing_provider_key_returns_503(self):
        headers = self.sign_in(self.member)
        with patch.dict(os.environ, {"GEMINI_API_KEY": ""}):
            response = self.client.post(self.url, self.payload, format="json", headers=headers)
        self.assertEqual(response.status_code, 503)
        self.provider.assert_not_called()
