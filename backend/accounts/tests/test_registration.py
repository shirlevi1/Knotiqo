
from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient


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

        token = (
            self.client.cookies["csrftoken"].value
            if csrf is None
            else csrf
        )

        headers = {"HTTP_X_CSRFTOKEN": token} if token else {}

        return self.client.post(
            "/api/auth/register/",
            payload,
            format="json",
            **headers,
        )

    def test_register_creates_user(self):
        response = self.register()

        self.assertEqual(response.status_code, 201)

        user = get_user_model().objects.get(
            username="new_bride"
        )

        self.assertEqual(response.json()["id"], user.pk)
        self.assertEqual(user.email, "bride@example.com")
        self.assertTrue(
            user.check_password("MyWedding#2026!")
        )

    def test_duplicate_username_is_rejected_case_insensitively(self):
        users = get_user_model().objects

        users.create_user(username="New_Bride")

        response = self.register()

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json()["error"],
            "Username already exists",
        )
        self.assertEqual(
            users.filter(username__iexact="new_bride").count(),
            1,
        )

    def test_invalid_passwords_do_not_create_users(self):
        for password in (
                "Ab1!",
                "Wedding2026",
                "12345678!",
                "password123",
        ):
            with self.subTest(password=password):
                response = self.register(
                    password=password,
                    confirm_password=password,
                )

                self.assertEqual(response.status_code, 400)
                self.assertEqual(
                    response.json()["error"],
                    "Validation failed",
                )
                self.assertFalse(
                    get_user_model().objects.filter(
                        username="new_bride"
                    ).exists()
                )

    def test_registration_requires_valid_csrf(self):
        for token in ("", "invalid"):
            with self.subTest(token=token):
                self.assertEqual(
                    self.register(csrf=token).status_code,
                    403,
                )
                self.assertFalse(
                    get_user_model().objects.filter(
                        username="new_bride"
                    ).exists()
                )

    def test_registered_user_can_login_restore_and_logout(self):
        self.assertEqual(self.register().status_code, 201)
        self.assertEqual(
            self.client.get("/api/auth/me/").status_code,
            401,
        )

        login = self.client.post(
            "/api/auth/login/",
            {
                "username": "new_bride",
                "password": "MyWedding#2026!",
            },
            format="json",
            HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value,
        )

        self.assertEqual(login.status_code, 200)

        cookie_name = settings.SESSION_COOKIE_NAME

        restored = APIClient(enforce_csrf_checks=True)
        restored.cookies[cookie_name] = login.cookies[cookie_name].value

        self.assertEqual(
            restored.get("/api/auth/me/").json(),
            login.json(),
        )

        restored.get("/api/auth/csrf/")

        for headers in (
                {},
                {"HTTP_X_CSRFTOKEN": "invalid"},
        ):
            self.assertEqual(
                restored.post("/api/auth/logout/", **headers).status_code,
                403,
            )
            self.assertEqual(
                restored.get("/api/auth/me/").status_code,
                200,
            )

        logout = restored.post(
            "/api/auth/logout/",
            HTTP_X_CSRFTOKEN=restored.cookies["csrftoken"].value,
        )

        self.assertEqual(logout.status_code, 200)
        self.assertEqual(
            restored.get("/api/auth/me/").status_code,
            401,
        )

        # The original cookie cannot restore an invalidated session.
        self.assertEqual(
            self.client.get("/api/auth/me/").status_code,
            401,
        )
