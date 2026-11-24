
import json

from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_http_methods, require_POST
from django.views.decorators.cache import never_cache
from django.views.decorators.debug import sensitive_variables
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, connection, transaction

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
        "first_name": user.first_name.strip() or None,
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
        "first_name": request.user.first_name.strip() or None,
    })


def lock_account_email_writes():
    # Django's default User email is not unique. Serialize the application's
    # registration and profile changes without dropping historical accounts.
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(%s)", [816408201])


@never_cache
@require_http_methods(["GET", "POST"])
@csrf_protect
def update_profile_view(request):
    user = request.user
    if not user.is_authenticated or not user.is_active:
        return JsonResponse({"error": "Not authenticated"}, status=401)

    fields = {"first_name", "last_name", "email"}
    if request.method == "GET":
        return JsonResponse({field: getattr(user, field) for field in fields})
    data = parse_json_body(request)
    if not data or set(data) - fields or not all(isinstance(value, str) for value in data.values()):
        return JsonResponse({"error": "Invalid profile fields"}, status=400)
    changes = {field: value.strip() for field, value in data.items()}
    for field, value in changes.items():
        if (len(value) > user._meta.get_field(field).max_length or (value and not value.isprintable())
                or (not value and field != "last_name")):
            return JsonResponse({"error": "Invalid profile field", "field": field}, status=400)
        if field == "email":
            try:
                validate_email(value)
            except ValidationError:
                return JsonResponse({"error": "Invalid email address", "field": "email"}, status=400)
    with transaction.atomic():
        if "email" in changes:
            lock_account_email_writes()
            if get_user_model().objects.filter(email__iexact=changes["email"]).exclude(pk=user.pk).exists():
                return JsonResponse({"error": "Email already exists", "field": "email"}, status=400)
        for field, value in changes.items():
            setattr(user, field, value)
        user.save(update_fields=list(changes))
    return JsonResponse(changes)


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
@never_cache
@sensitive_variables("data", "old_password", "new_password", "confirmation")
def change_password_view(request):
    if not request.user.is_authenticated or not request.user.is_active:
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
    confirmation = data.get("confirm_password")

    if not all(isinstance(value, str) and 0 < len(value) <= 4096
               for value in (old_password, new_password, confirmation)):
        return JsonResponse(
            {"error": "Old and new passwords are required"},
            status=400,
        )

    if new_password != confirmation:
        return JsonResponse({"error": "Passwords do not match"}, status=400)
    with transaction.atomic():
        user = get_user_model().objects.select_for_update().get(pk=request.user.pk)
        if not user.check_password(old_password):
            return JsonResponse({"error": "Current password is incorrect"}, status=400)
        try:
            validate_password(new_password, user=user)
        except ValidationError as error:
            return JsonResponse({"error": "Password validation failed",
                                 "codes": [item.code for item in error.error_list]}, status=400)
        user.set_password(new_password)
        user.save(update_fields=["password"])

    # Keep the current session authenticated after changing password
    update_session_auth_hash(request, user)

    return JsonResponse({
        "message": "Password changed successfully",
    })

# ==========================================
# Register
# ==========================================

@require_POST
@csrf_protect
def register_view(request):
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse(
            {"error": "Invalid JSON"},
            status=400,
        )

    if not isinstance(data, dict):
        return JsonResponse(
            {"error": "Invalid request body"},
            status=400,
        )

    username = data.get("username")
    email = data.get("email")
    password = data.get("password")
    confirm_password = data.get("confirm_password")

    # 1. Validate input types
    if not all(
            isinstance(value, str)
            for value in (
                    username,
                    email,
                    password,
                    confirm_password,
            )
    ):
        return JsonResponse(
            {"error": "All fields are required"},
            status=400,
        )

    username = username.strip()
    email = email.strip()

    if not username or not email or not password:
        return JsonResponse(
            {"error": "All fields are required"},
            status=400,
        )

    # 2. Check password confirmation
    if password != confirm_password:
        return JsonResponse(
            {"error": "Passwords do not match"},
            status=400,
        )

    # 3. Validate email format
    try:
        validate_email(email)
    except ValidationError:
        return JsonResponse(
            {"error": "Invalid email address"},
            status=400,
        )

    User = get_user_model()

    # 4. Check duplicate username
    if User.objects.filter(username__iexact=username).exists():
        return JsonResponse(
            {"error": "Username already exists"},
            status=400,
        )

    # 5. Check duplicate email
    if User.objects.filter(email__iexact=email).exists():
        return JsonResponse(
            {"error": "Email already exists"},
            status=400,
        )

    # 6. Validate password strength
    new_user = User(
        username=username,
        email=email,
    )

    try:
        new_user.full_clean(
            exclude=["password"],
            validate_unique=False,
            validate_constraints=False,
        )
        validate_password(password, user=new_user)
    except ValidationError as error:
        return JsonResponse(
            {
                "error": "Validation failed",
                "details": (
                    error.message_dict
                    if hasattr(error, "message_dict")
                    else error.messages
                ),
            },
            status=400,
        )

    # 7. Create the user
    try:
        with transaction.atomic():
            lock_account_email_writes()
            if User.objects.filter(email__iexact=email).exists():
                return JsonResponse({"error": "Email already exists"}, status=400)
            user = User.objects.create_user(
                username=username,
                email=email,
                password=password,
            )
    except IntegrityError:
        return JsonResponse(
            {"error": "Unable to create account"},
            status=400,
        )

    # 8. Return a successful response
    return JsonResponse(
        {
            "id": user.id,
            "username": user.get_username(),
            "email": user.email,
            "message": "Account created successfully",
        },
        status=201,
    )
