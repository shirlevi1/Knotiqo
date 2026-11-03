
import re

from django.core.exceptions import ValidationError
from django.utils.translation import gettext_lazy as _


class PasswordComplexityValidator:
    def validate(self, password, user=None):
        if not re.search(r"[A-Za-z\u0590-\u05FF]", password):
            raise ValidationError(
                _("הסיסמה חייבת לכלול לפחות אות אחת."),
                code="password_no_letter",
            )

        if not re.search(r"[^A-Za-z0-9\u0590-\u05FF]", password):
            raise ValidationError(
                _("הסיסמה חייבת לכלול לפחות תו מיוחד אחד."),
                code="password_no_special",
            )

    def get_help_text(self):
        return _(
            "הסיסמה חייבת לכלול לפחות אות אחת ותו מיוחד אחד."
        )
