import hashlib
import hmac
import json
import re
import secrets
from datetime import timedelta
from urllib.parse import urlsplit

from django.conf import settings
from django.db import DatabaseError, transaction
from django.http import Http404, JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.debug import sensitive_variables
from django.views.decorators.http import require_http_methods, require_POST

from .models import GUEST_AGE_FIELDS, Guest, GuestRSVP, RSVPRateWindow
from .services import weddings_for_user


TOKEN = re.compile(r"[A-Za-z0-9_-]{43}")
LINK_LIFETIME = timedelta(days=30)


def public_origin():
    url = settings.PUBLIC_BASE_URL
    try:
        parsed = urlsplit(url)
        host = parsed.hostname or ""
        if (parsed.scheme != "https" or parsed.netloc not in (host, f"{host}:443")
                or parsed.path not in ("", "/") or parsed.query or parsed.fragment
                or "?" in url or "#" in url
                or not re.fullmatch(r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}", host)
                or host in {"example.com", "example.net", "example.org"}
                or host.endswith((".localhost", ".local", ".internal", ".test", ".invalid", ".example",
                                  ".example.com", ".example.org", ".example.net"))):
            return None
        return f"https://{host}"
    except ValueError:
        return None


def response_snapshot(rsvp):
    if not rsvp or not rsvp.status:
        return None
    return {
        "status": rsvp.status, "attendee_count": rsvp.attendee_count,
        **{field: getattr(rsvp, field) for field in GUEST_AGE_FIELDS},
        "responded_at": rsvp.responded_at.isoformat(),
    }


def token_hash(token):
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def issue_response(guest, rsvp, origin):
    return {
        "sharing_enabled": bool(origin),
        "link_active": bool(rsvp and rsvp.token_hash and rsvp.expires_at > timezone.now() and not guest.is_archived),
        "expires_at": rsvp.expires_at if rsvp else None,
        "response": response_snapshot(rsvp),
    }


@never_cache
@require_http_methods(["GET", "POST", "DELETE"])
@csrf_protect
@transaction.atomic
@sensitive_variables("token")
def guest_rsvp_link(request, wedding_id, guest_id):
    if not request.user.is_authenticated or not request.user.is_active:
        return JsonResponse({"error": "not_authenticated"}, status=403)
    scoped = Guest.objects.filter(wedding__in=weddings_for_user(user=request.user).filter(pk=wedding_id))
    if request.method != "GET":
        scoped = scoped.select_for_update(of=("self",))
    guest = get_object_or_404(scoped, pk=guest_id)
    origin = public_origin()
    rsvp = GuestRSVP.objects.filter(guest=guest).first()
    if request.method == "POST":
        if guest.is_archived:
            raise Http404()
        if not origin:
            return JsonResponse({"error": "sharing_disabled"}, status=409)
        if rsvp is None:
            rsvp = GuestRSVP(guest=guest)
        token = secrets.token_urlsafe(32)
        rsvp.token_hash = token_hash(token)
        rsvp.expires_at = timezone.now() + LINK_LIFETIME
        rsvp.save()
        return JsonResponse({**issue_response(guest, rsvp, origin), "url": f"{origin}/#/rsvp/{token}"}, status=201)
    if request.method == "DELETE" and rsvp:
        rsvp.token_hash = None
        rsvp.expires_at = None
        rsvp.save(update_fields=["token_hash", "expires_at"])
    return JsonResponse(issue_response(guest, rsvp, origin))


@transaction.atomic
def reserve(label, value, limit):
    key = hmac.new(settings.SECRET_KEY.encode(), f"rsvp:{label}:{value}".encode(), hashlib.sha256).hexdigest()
    now = timezone.now().replace(second=0, microsecond=0)
    record, _ = RSVPRateWindow.objects.select_for_update().get_or_create(key=key, defaults={"window_start": now})
    if record.window_start < now:
        record.window_start, record.count = now, 0
    if record.count >= limit:
        return False
    record.count += 1
    record.save(update_fields=["window_start", "count"])
    return True


def invalid_link():
    return JsonResponse({"error": "invalid_link"}, status=404)


def limited():
    return JsonResponse({"error": "rate_limited"}, status=429, headers={"Retry-After": "60"})


def valid_quantities(guest, data):
    status = data.get("status")
    if not isinstance(status, str) or status not in GuestRSVP.Status.values:
        return None
    known = guest.adult_count is not None
    base = {"token", "action", "status"}
    extras = set(data) - base
    if status != GuestRSVP.Status.ATTENDING:
        return (status, 0, dict.fromkeys(GUEST_AGE_FIELDS)) if not extras else None
    fields = GUEST_AGE_FIELDS if known else ("attendee_count",)
    if extras != set(fields) or any(type(data[field]) is not int or data[field] < 0 for field in fields):
        return None
    if known and any(data[field] > getattr(guest, field) for field in fields):
        return None
    total = sum(data[field] for field in fields)
    if not 1 <= total <= guest.party_size:
        return None
    return status, total, {field: data.get(field) for field in GUEST_AGE_FIELDS}


@transaction.atomic
def apply_response(guest_id, hashed, data):
    guest = Guest.objects.select_for_update().filter(pk=guest_id, is_archived=False).first()
    if guest is None:
        return invalid_link()
    rsvp = GuestRSVP.objects.filter(guest=guest, token_hash=hashed, expires_at__gt=timezone.now()).first()
    if not rsvp:
        return invalid_link()
    quantities = valid_quantities(guest, data)
    if quantities is None:
        return JsonResponse({"error": "invalid_attendance"}, status=400)
    status, total, ages = quantities
    if (rsvp.status, rsvp.attendee_count, *(getattr(rsvp, field) for field in ages)) != (status, total, *ages.values()):
        rsvp.status = status
        rsvp.attendee_count = total
        for field, value in ages.items():
            setattr(rsvp, field, value)
        rsvp.responded_at = timezone.now()
        rsvp.save(update_fields=["status", "attendee_count", *ages, "responded_at"])
    return JsonResponse({"saved": True})


@never_cache
@require_POST
@csrf_protect
@sensitive_variables("data", "token", "hashed")
def public_rsvp(request):
    origin = public_origin()
    if not origin or not request.is_secure() or origin != f"https://{request.get_host().removesuffix(':443')}":
        return invalid_link()
    try:
        if not reserve("address", request.META.get("REMOTE_ADDR", "unknown"), 120):
            return limited()
        length = request.META.get("CONTENT_LENGTH", "")
        if request.content_type != "application/json" or not length.isascii() or not length.isdecimal():
            return JsonResponse({"error": "invalid_request"}, status=400)
        if len(length) > 4 or int(length) > 4096:
            return JsonResponse({"error": "invalid_request"}, status=413)
        try:
            data = json.loads(request.body)
        except (ValueError, UnicodeError, RecursionError):
            return JsonResponse({"error": "invalid_request"}, status=400)
        if not isinstance(data, dict) or not isinstance(token := data.get("token"), str) or not TOKEN.fullmatch(token):
            return invalid_link()
        hashed = token_hash(token)
        rsvp = GuestRSVP.objects.filter(
            token_hash=hashed, expires_at__gt=timezone.now(), guest__is_archived=False,
        ).select_related("guest__wedding").first()
        if not rsvp:
            return invalid_link()
        if not reserve("invitation", hashed, 12):
            return limited()
        if data.get("action") == "respond":
            return apply_response(rsvp.guest_id, hashed, data)
        if data.get("action") != "read" or set(data) != {"token", "action"}:
            return JsonResponse({"error": "invalid_request"}, status=400)
        guest = rsvp.guest
        wedding = guest.wedding
        return JsonResponse({
            "creator_display_name": wedding.creator_display_name,
            "partner_display_name": wedding.partner_display_name,
            "wedding_date": wedding.wedding_date,
            "invited_count": guest.party_size,
            "age_limits": {field: getattr(guest, field) for field in GUEST_AGE_FIELDS} if guest.adult_count is not None else None,
            "options": GuestRSVP.Status.values,
        })
    except DatabaseError:
        return JsonResponse({"error": "unavailable"}, status=503)
