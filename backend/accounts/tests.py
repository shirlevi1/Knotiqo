
from django.conf import settings
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

class RegistrationTests(TestCase):

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.client.get("/api/auth/csrf/")

    def register(self, *, csrf=None, **overrides):
        payload = {
            "username": "new_bride",
            "email": "bride@example.com",
            "password": "MyWedding#2026!",
            "confirm_password": "MyWedding#2026!",
        }
        payload.update(overrides)
        token = self.client.cookies["csrftoken"].value if csrf is None else csrf
        headers = {"HTTP_X_CSRFTOKEN": token} if token else {}
        return self.client.post("/api/auth/register/", payload, format="json", **headers)

    def test_register_creates_user(self):
        response = self.register()
        self.assertEqual(response.status_code, 201)
        user = get_user_model().objects.get(username="new_bride")
        self.assertEqual(response.json()["id"], user.pk)
        self.assertEqual(user.email, "bride@example.com")
        self.assertTrue(user.check_password("MyWedding#2026!"))

    def test_duplicate_username_is_rejected_case_insensitively(self):
        users = get_user_model().objects
        users.create_user(username="New_Bride")
        response = self.register()
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "Username already exists")
        self.assertEqual(users.filter(username__iexact="new_bride").count(), 1)

    def test_invalid_passwords_do_not_create_users(self):
        for password in ("Ab1!", "Wedding2026", "12345678!", "password123"):
            with self.subTest(password=password):
                response = self.register(password=password, confirm_password=password)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["error"], "Validation failed")
                self.assertFalse(get_user_model().objects.filter(username="new_bride").exists())

    def test_registration_requires_valid_csrf(self):
        for token in ("", "invalid"):
            with self.subTest(token=token):
                self.assertEqual(self.register(csrf=token).status_code, 403)
                self.assertFalse(get_user_model().objects.filter(username="new_bride").exists())

    def test_registered_user_can_login_restore_and_logout(self):
        self.assertEqual(self.register().status_code, 201)
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)
        login = self.client.post(
            "/api/auth/login/",
            {"username": "new_bride", "password": "MyWedding#2026!"},
            format="json", HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value,
        )
        self.assertEqual(login.status_code, 200)

        cookie_name = settings.SESSION_COOKIE_NAME
        restored = APIClient(enforce_csrf_checks=True)
        restored.cookies[cookie_name] = login.cookies[cookie_name].value
        self.assertEqual(restored.get("/api/auth/me/").json(), login.json())
        restored.get("/api/auth/csrf/")
        for headers in ({}, {"HTTP_X_CSRFTOKEN": "invalid"}):
            self.assertEqual(restored.post("/api/auth/logout/", **headers).status_code, 403)
            self.assertEqual(restored.get("/api/auth/me/").status_code, 200)

        logout = restored.post(
            "/api/auth/logout/", HTTP_X_CSRFTOKEN=restored.cookies["csrftoken"].value,
        )
        self.assertEqual(logout.status_code, 200)
        self.assertEqual(restored.get("/api/auth/me/").status_code, 401)
        # The original cookie cannot restore a session invalidated on the server.
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)
