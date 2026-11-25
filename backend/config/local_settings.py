import os

from .settings import *  # noqa: F403


DEBUG = False
ALLOWED_HOSTS = ["127.0.0.1"]
CSRF_TRUSTED_ORIGINS = []
ROOT_URLCONF = "config.local_urls"
SESSION_COOKIE_NAME = "knotiqo_local_session"

# Set by the launcher and stored outside the frontend build. Keep it stable
# across restarts for session and application signing.
SECRET_KEY = os.environ["KNOTIQO_LOCAL_SECRET"]
LOCAL_INSTANCE = os.environ["KNOTIQO_LOCAL_INSTANCE"]
LOCAL_BUILD = BASE_DIR.parent / "frontend" / "dist"  # noqa: F405
DATABASES["default"]["OPTIONS"] = {  # noqa: F405
    **DATABASES["default"].get("OPTIONS", {}),  # noqa: F405
    "connect_timeout": 3,
}
