
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient


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
