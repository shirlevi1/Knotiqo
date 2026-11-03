
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.test import SimpleTestCase


class PasswordValidationTests(SimpleTestCase):

    def test_short_password_is_rejected(self):
        with self.assertRaises(ValidationError):
            validate_password("Ab1!")

    def test_numeric_password_is_rejected(self):
        with self.assertRaises(ValidationError):
            validate_password("123456789012")

    def test_common_password_is_rejected(self):
        with self.assertRaises(ValidationError):
            validate_password("password123")

    def test_strong_password_is_accepted(self):
        validate_password("Knotiqo!Wedding2026#")


class AuthenticationTests(TestCase):

    def setUp(self):
        User = get_user_model()

        self.user = User.objects.create_user(
            username="test_user",
            password="TestPassword123!"
        )

        self.client = APIClient(enforce_csrf_checks=True)

    def test_login_and_logout(self):
        # Get CSRF cookie
        self.client.get("/api/auth/csrf/")
        csrf_token = self.client.cookies["csrftoken"].value

        # Login
        response = self.client.post(
            "/api/auth/login/",
            {
                "username": "test_user",
                "password": "TestPassword123!"
            },
            format="json",
            HTTP_X_CSRFTOKEN=csrf_token,
        )

        self.assertEqual(response.status_code, 200)

        # Verify authenticated session
        response = self.client.get("/api/auth/me/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["username"],
            "test_user"
        )

        # Logout
        response = self.client.post(
            "/api/auth/logout/",
            HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value,
        )

        self.assertEqual(response.status_code, 200)

        # Verify session ended
        response = self.client.get("/api/auth/me/")

        self.assertEqual(response.status_code, 401)

    def test_login_with_wrong_password(self):
        # Get CSRF cookie
        self.client.get("/api/auth/csrf/")
        csrf_token = self.client.cookies["csrftoken"].value

        # Attempt login with incorrect password
        response = self.client.post(
            "/api/auth/login/",
            {
                "username": "test_user",
                "password": "wrong-password"
            },
            format="json",
            HTTP_X_CSRFTOKEN=csrf_token,
        )

        self.assertEqual(response.status_code, 401)

    def test_login_without_csrf_is_rejected(self):
        # Attempt login without CSRF token
        response = self.client.post(
            "/api/auth/login/",
            {
                "username": "test_user",
                "password": "TestPassword123!",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)

        # Verify user is still not authenticated
        me_response = self.client.get("/api/auth/me/")

        self.assertEqual(me_response.status_code, 401)

    def test_login_with_invalid_csrf_is_rejected(self):
        self.client.get("/api/auth/csrf/")
        response = self.client.post(
            "/api/auth/login/",
            {"username": "test_user", "password": "TestPassword123!"},
            format="json",
            HTTP_X_CSRFTOKEN="invalid",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)

    def test_login_rejects_invalid_json_and_credential_types(self):
        self.client.get("/api/auth/csrf/")
        for body in ('{', '[]', '{}', '{"username": 42, "password": false}'):
            with self.subTest(body=body):
                response = self.client.post(
                    "/api/auth/login/",
                    data=body,
                    content_type="application/json",
                    HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value,
                )
                self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)

    def test_inactive_user_cannot_login(self):
        self.user.is_active = False
        self.user.save(update_fields=["is_active"])
        self.client.get("/api/auth/csrf/")
        response = self.client.post(
            "/api/auth/login/",
            {"username": "test_user", "password": "TestPassword123!"},
            format="json",
            HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value,
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)

def test_password_without_special_character_is_rejected(self):
    with self.assertRaises(ValidationError):
        validate_password("MyWedding2026")


def test_password_without_letter_is_rejected(self):
    with self.assertRaises(ValidationError):
        validate_password("12345678!")


def test_password_with_letter_and_special_character_is_accepted(self):
    validate_password("Wedding#2026Lovely")
