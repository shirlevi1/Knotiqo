
from django.test import SimpleTestCase
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError


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

    def test_password_without_special_character_is_rejected(self):
        with self.assertRaises(ValidationError):
            validate_password("MyWedding2026")

    def test_password_without_letter_is_rejected(self):
        with self.assertRaises(ValidationError):
            validate_password("12345678!")

    def test_password_with_letter_and_special_character_is_accepted(self):
        validate_password("Wedding#2026Lovely")
