
import json

from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST


# ==========================================
# Helpers
# ==========================================

def parse_json_body(request):
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None

    return data if isinstance(data, dict) else None


# ==========================================
# CSRF
# ==========================================

@require_GET
@ensure_csrf_cookie
def csrf_view(request):
    return JsonResponse({"message": "CSRF cookie set"})


# ==========================================
# Login
# ==========================================

@require_POST
@csrf_protect
def login_view(request):
    data = parse_json_body(request)

    if data is None:
        return JsonResponse(
            {"error": "Invalid JSON request body"},
            status=400,
        )

    username = data.get("username")
    password = data.get("password")

    if not isinstance(username, str) or not isinstance(password, str):
        return JsonResponse(
            {"error": "Username and password are required"},
            status=400,
        )

    user = authenticate(
        request,
        username=username,
        password=password,
    )

    if user is None:
        return JsonResponse(
            {"error": "Invalid credentials"},
            status=401,
        )

    login(request, user)

    return JsonResponse({
        "id": user.id,
        "username": user.get_username(),
    })


# ==========================================
# Current User
# ==========================================

@require_GET
def me_view(request):
    if not request.user.is_authenticated:
        return JsonResponse(
            {"error": "Not authenticated"},
            status=401,
        )

    return JsonResponse({
        "id": request.user.id,
        "username": request.user.get_username(),
    })


# ==========================================
# Logout
# ==========================================

@require_POST
@csrf_protect
def logout_view(request):
    logout(request)

    return JsonResponse({
        "message": "Logged out",
    })


# ==========================================
# Change Password
# ==========================================

@require_POST
@csrf_protect
def change_password_view(request):
    if not request.user.is_authenticated:
        return JsonResponse(
            {"error": "Not authenticated"},
            status=401,
        )

    data = parse_json_body(request)

    if data is None:
        return JsonResponse(
            {"error": "Invalid JSON request body"},
            status=400,
        )

    old_password = data.get("old_password")
    new_password = data.get("new_password")

    if not isinstance(old_password, str) or not isinstance(new_password, str):
        return JsonResponse(
            {"error": "Old and new passwords are required"},
            status=400,
        )

    user = request.user

    # Verify the current password
    if not user.check_password(old_password):
        return JsonResponse(
            {"error": "Current password is incorrect"},
            status=400,
        )

    # Validate the new password against Django's configured validators
    try:
        validate_password(new_password, user=user)
    except ValidationError as error:
        return JsonResponse(
            {
                "error": "Password validation failed",
                "details": error.messages,
            },
            status=400,
        )

    # Hash and save the new password
    user.set_password(new_password)
    user.save(update_fields=["password"])

    # Keep the current session authenticated after changing password
    from django.contrib.auth import update_session_auth_hash
    update_session_auth_hash(request, user)

    return JsonResponse({
        "message": "Password changed successfully",
    })
