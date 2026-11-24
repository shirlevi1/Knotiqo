import json
import re
import unicodedata
from collections import defaultdict
from datetime import timedelta
from hashlib import sha256
from uuid import uuid4

from django.db import transaction
from django.http import Http404
from django.utils import timezone
from rest_framework import serializers

from .guest_workbook import MAX_COLUMNS, MAX_DATA_ROWS, MAX_SOURCE_ROW, ImportIssue
from .guests import GuestSerializer
from .models import GUEST_AGE_FIELDS, Guest, GuestImportSession, Wedding
from .services import weddings_for_user


HEADINGS = {
    "full_name": ("full name", "name", "guest name", "שם", "שם מלא", "שם האורח", "שם המוזמן"),
    "phone": ("phone", "mobile", "telephone", "phone number", "טלפון", "נייד", "מספר טלפון"),
    "email": ("email", "e-mail", "email address", "אימייל", "מייל", "דואל", "דואר אלקטרוני"),
    "side": ("side", "wedding side", "צד", "צד בחתונה"),
    "category": ("category", "guest category", "type", "קטגוריה", "סוג", "סוג אורח"),
    "party_size": ("party size", "guest count", "invited count", "מספר אורחים", "כמות", "מספר מוזמנים", "כמות מוזמנים"),
    "adult_count": ("adults", "adult count", "מבוגרים", "מספר מבוגרים"),
    "child_count": ("children", "child count", "ילדים", "מספר ילדים"),
    "infant_count": ("infants", "infant count", "תינוקות", "מספר תינוקות"),
    "family_group": ("family group", "family", "משפחה", "קבוצה משפחתית"),
    "notes": ("notes", "comments", "הערות"),
}
CHOICE_ALIASES = {
    "side": {"כלה": "bride", "חתן": "groom", "משותף": "joint", "לא משויך": "unassigned"},
    "category": {"מבוגר": "adult", "ילד": "child", "תינוק": "infant"},
}
MAX_EXISTING_GUESTS = 5000
SESSION_TTL = timedelta(minutes=30)


def normalize_space(value):
    return " ".join(value.split())


def heading_key(value):
    return re.sub(r"[^\w]+", "", unicodedata.normalize("NFKC", value).casefold()).replace("_", "")


def column_info(sheet):
    rows = sheet["rows"]
    headings = rows[0][1] if rows and rows[0][0] == 1 else {}
    count = max((int(column) for _, row in rows for column in row), default=0)
    aliases = {heading_key(alias): field for field, names in HEADINGS.items() for alias in names}
    return [
        {"column": column, "heading": text, "suggested_field": aliases.get(heading_key(text))}
        for column in range(1, count + 1)
        for text in [normalize_space(headings.get(str(column), [""])[0])]
    ]


class PreviewInput(serializers.Serializer):
    worksheet = serializers.CharField(max_length=31, trim_whitespace=False)
    mapping = serializers.DictField(child=serializers.IntegerField(min_value=1, max_value=MAX_COLUMNS))

    def validate_mapping(self, mapping):
        if "full_name" not in mapping or set(mapping) - HEADINGS.keys() or len(set(mapping.values())) != len(mapping):
            raise serializers.ValidationError("Map the full name and use each column at most once.")
        return mapping


class DecisionInput(serializers.Serializer):
    row = serializers.IntegerField(min_value=2, max_value=MAX_SOURCE_ROW)
    action = serializers.ChoiceField(choices=["create", "skip", "update", "restore"])
    guest_id = serializers.IntegerField(min_value=1, max_value=2**63 - 1, required=False)

    def validate(self, attrs):
        if ("guest_id" in attrs) != (attrs["action"] in {"update", "restore"}):
            raise serializers.ValidationError("Only update and restore require a guest ID.")
        return attrs

    def to_internal_value(self, data):
        if isinstance(data, dict) and set(data) - self.fields.keys():
            raise serializers.ValidationError("Unexpected fields.")
        return super().to_internal_value(data)


class ConfirmInput(serializers.Serializer):
    preview_id = serializers.UUIDField()
    decisions = DecisionInput(many=True, max_length=MAX_DATA_ROWS, allow_empty=False)

    def validate_decisions(self, decisions):
        targets = [item["guest_id"] for item in decisions if "guest_id" in item]
        if (len({item["row"] for item in decisions}) != len(decisions)
                or len(set(targets)) != len(targets)):
            raise serializers.ValidationError("Rows and target guests must be distinct.")
        return decisions


def create_session(user, wedding_id, sheets):
    now = timezone.now()
    with transaction.atomic():
        if not Wedding.objects.select_for_update().filter(
            pk__in=weddings_for_user(user=user).filter(pk=wedding_id).values("pk"),
        ).first():
            raise Http404()
        sessions = GuestImportSession.objects.filter(wedding_id=wedding_id)
        sessions.filter(expires_at__lte=now).delete()
        if sessions.count() >= 8:
            raise ImportIssue("session_limit", 429)
        return sessions.create(wedding_id=wedding_id, user=user, expires_at=now + SESSION_TTL, sheets=sheets)


def locked_session(user, wedding_id, session_id):
    session = GuestImportSession.objects.select_for_update().filter(
        id=session_id, user=user, wedding_id__in=weddings_for_user(user=user).filter(pk=wedding_id).values("pk"),
    ).first()
    if session is None:
        raise Http404()
    if session.expires_at <= timezone.now():
        raise ImportIssue("session_expired", 410)
    return session


def row_data(cells, mapping):
    payload, errors, warnings = {}, {}, []
    for field, column in mapping.items():
        value, kind = cells.get(str(column), ("", ""))
        value = value.strip() if field == "notes" else normalize_space(value)
        if kind in {"formula", "unsupported"}:
            errors[field] = [kind]
            continue
        if not value and field != "full_name":
            continue
        if field == "phone":
            value = re.sub(r"[ ().-]", "", value)
            if kind == "numeric":
                warnings.append("check_numeric_phone_leading_zeros")
        if field in CHOICE_ALIASES:
            value = CHOICE_ALIASES[field].get(value, value.casefold())
        payload[field] = value
    if any(field in payload for field in GUEST_AGE_FIELDS):
        for field in GUEST_AGE_FIELDS:
            payload.setdefault(field, "0")
    serializer = GuestSerializer(data=payload)
    if not serializer.is_valid():
        for field, messages in serializer.errors.items():
            errors.setdefault(field, [str(message.code) for message in messages])
    elif "adult_count" in payload:
        payload["party_size"] = str(serializer.validated_data["party_size"])
    return payload, errors, warnings


def match_keys(data):
    phone = re.sub(r"[^0-9]", "", data.get("phone", ""))
    email = data.get("email", "").strip().casefold()
    name = unicodedata.normalize("NFKC", normalize_space(data["full_name"])).casefold()
    return [(field, value) for field, value in (("phone", phone), ("email", email), ("name", name)) if value]


def match_candidates(keys, index, exclude=None):
    matches = {}
    truncated = False
    for key in keys:
        matches_for_key = index.get(key, [])
        truncated |= len(matches_for_key) > 8
        for identity in matches_for_key[:9]:
            if identity != exclude:
                matches.setdefault(identity, []).append(key[0])
    ranked = sorted(matches.items(), key=lambda pair: (pair[1] == ["name"], pair[0]))
    return ranked[:8], truncated or len(ranked) > 8


def duplicate_details(wedding_id, rows):
    existing = list(Guest.objects.filter(wedding_id=wedding_id).values(
        "id", "full_name", "phone", "email", "is_archived", "updated_at",
    )[:MAX_EXISTING_GUESTS + 1])
    if len(existing) > MAX_EXISTING_GUESTS:
        raise ImportIssue("guest_list_limit", 409)
    guest_index, row_index = defaultdict(list), defaultdict(list)
    guests = {entry["id"]: entry for entry in existing}
    for guest in existing:
        guest["updated_at"] = guest["updated_at"].isoformat()
        for key in match_keys(guest):
            guest_index[key].append(guest["id"])
    valid = [row for row in rows if not row["errors"]]
    for row in valid:
        for key in match_keys(row["values"]):
            row_index[key].append(row["row"])
    for row in valid:
        keys = match_keys(row["values"])
        file_matches, file_truncated = match_candidates(keys, row_index, row["row"])
        guest_matches, guest_truncated = match_candidates(keys, guest_index)
        row["duplicates"] = {
            "rows": [{"row": number, "matched_on": fields} for number, fields in file_matches],
            "guests": [{**guests[pk], "matched_on": fields} for pk, fields in guest_matches],
        }
        if file_truncated or guest_truncated:
            row["warnings"].append("duplicate_suggestions_truncated")


@transaction.atomic
def preview_session(user, wedding_id, session_id, worksheet, mapping):
    session = locked_session(user, wedding_id, session_id)
    if session.confirmation_hash:
        raise ImportIssue("already_confirmed", 409)
    sheet = next((item for item in session.sheets if item["name"] == worksheet), None)
    if sheet is None or max(mapping.values()) > len(column_info(sheet)):
        raise ImportIssue("invalid_mapping")
    rows = []
    name_column = str(mapping["full_name"])
    header = next((cells for number, cells in sheet["rows"] if number == 1), {})
    headings = {heading_key(alias) for alias in HEADINGS["full_name"]}
    headings.add(heading_key(header.get(name_column, [""])[0]))
    section_labels = {heading_key(label) for label in (
        "total", "grand total", "subtotal", "summary", "notes", "guest list",
        "סה״כ", "סך הכול", "סך הכל", "סיכום", "הערות", "רשימת מוזמנים",
    )}
    section_boundary = False
    for number, cells in sheet["rows"]:
        if number == 1:
            continue
        data, errors, warnings = row_data(cells, mapping)
        name_key = heading_key(data.get("full_name", ""))
        if name_key and (name_key in headings or name_key in section_labels):
            errors.setdefault("full_name", []).append("non_guest_row")
            section_boundary = True
        elif section_boundary:
            warnings.append("review_section_boundary")
        rows.append({"row": number, "values": data, "errors": errors, "warnings": warnings})
    duplicate_details(wedding_id, rows)
    used = set(mapping.values())
    preview = {
        "preview_id": str(uuid4()), "worksheet": worksheet, "rows": rows,
        "unmapped_columns": [column for column in column_info(sheet) if column["column"] not in used],
    }
    session.preview = preview
    session.save(update_fields=["preview"])
    return preview


@transaction.atomic
def confirm_session(user, wedding_id, session_id, preview_id, decisions):
    session = locked_session(user, wedding_id, session_id)
    decisions = sorted(decisions, key=lambda decision: decision["row"])
    digest = sha256(json.dumps([str(preview_id), decisions], sort_keys=True).encode()).hexdigest()
    if session.confirmation_hash:
        if session.confirmation_hash == digest:
            return session.result
        raise ImportIssue("already_confirmed", 409)
    if session.preview.get("preview_id") != str(preview_id):
        raise ImportIssue("stale_preview", 409)

    rows = {row["row"]: row for row in session.preview["rows"]}
    targets = {decision["guest_id"] for decision in decisions if "guest_id" in decision}
    guests = {
        guest.pk: guest for guest in Guest.objects.select_for_update()
        .filter(wedding_id=wedding_id, pk__in=targets).order_by("pk")
    }
    result = {"created": 0, "skipped": 0, "updated": 0, "restored": 0}
    for decision in decisions:
        row = rows.get(decision["row"])
        action = decision["action"]
        if row is None or (row["errors"] and action != "skip"):
            raise ImportIssue("invalid_selection")
        if action == "skip":
            result["skipped"] += 1
            continue
        if action == "create":
            serializer = GuestSerializer(data=row["values"])
            serializer.is_valid(raise_exception=True)
            serializer.save(wedding_id=wedding_id)
            result["created"] += 1
            continue
        guest = guests.get(decision["guest_id"])
        candidate = next((item for item in row["duplicates"]["guests"] if item["id"] == decision["guest_id"]), None)
        if candidate is None:
            raise ImportIssue("invalid_selection")
        if (guest is None or guest.updated_at.isoformat() != candidate["updated_at"]
                or guest.is_archived != (action == "restore")):
            raise ImportIssue("guest_changed", 409)
        values = row["values"].copy()
        if action == "restore":
            values["is_archived"] = False
        serializer = GuestSerializer(guest, data=values, partial=True)
        if not serializer.is_valid():
            if any(error.code == "guest_age_conflict" for error in serializer.errors.get("party_size", [])):
                raise ImportIssue("guest_age_conflict", 409)
            raise serializers.ValidationError(serializer.errors)
        serializer.save()
        result["restored" if action == "restore" else "updated"] += 1
    session.sheets = []
    session.preview = {}
    session.confirmation_hash = digest
    session.result = result
    session.save(update_fields=["sheets", "preview", "confirmation_hash", "result"])
    return result
