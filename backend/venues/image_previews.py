"""Short-lived venue previews and the authorization data used to save images."""

import hashlib
import secrets
from datetime import timedelta

from django.db import connection, transaction
from django.db.models.functions import Now

from .metadata_import import MetadataImportError, import_venue_metadata, normalize_url
from .models import VenueImagePreview, VenuePreviewRateWindow


PREVIEW_TTL = 300
RATE_LIMIT = 5


class PreviewError(Exception):
    def __init__(self, code, message, status_code, *, retry_after=None):
        super().__init__(message)
        self.code = code
        self.status_code = status_code
        self.retry_after = retry_after


def unavailable():
    return PreviewError("preview_unavailable", "Venue previews are temporarily unavailable.", 503)


def database_now():
    with connection.cursor() as cursor:
        cursor.execute("SELECT statement_timestamp()")
        return cursor.fetchone()[0]


@transaction.atomic
def reserve_preview(user_id):
    now = database_now()
    window_start = now.replace(second=0, microsecond=0)
    window, _ = VenuePreviewRateWindow.objects.select_for_update().get_or_create(
        user_id=user_id, window_start=window_start,
    )
    if window.request_count >= RATE_LIMIT:
        raise PreviewError(
            "preview_rate_limited", "Too many venue previews. Try again shortly.", 429,
            retry_after=60 - now.second,
        )
    window.request_count += 1
    window.save(update_fields=["request_count"])


def hash_preview_token(token):
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def create_preview(*, user_id, venue, website):
    try:
        website = normalize_url(website)
    except MetadataImportError as error:
        raise PreviewError(error.code, error.message, 400) from error
    reserve_preview(user_id)
    result = import_venue_metadata(website)
    if not result["ok"]:
        error = result["error"]
        status_code = {
            "invalid_url": 400, "blocked_destination": 400, "timeout": 504,
            "missing_metadata": 422, "unsupported_response": 422,
            "response_too_large": 422, "too_many_redirects": 422,
        }.get(error["code"], 502)
        raise PreviewError(error["code"], error["message"], status_code)

    metadata = result["metadata"]
    images = []
    candidates = {}
    for image in metadata["images"]:
        image_url = image["image_url"]
        if len(image_url) > 500:
            continue
        source_url = image["source_url"]
        if len(source_url) > 500:
            source_url = ""
        alt_text = image["alt_text"].replace("\x00", "")[:255]
        images.append({**image, "source_url": source_url, "alt_text": alt_text})
        candidates[image_url] = {"source_url": source_url, "alt_text": alt_text}

    token = secrets.token_urlsafe(32)
    VenueImagePreview.objects.create(
        token_hash=hash_preview_token(token), user_id=user_id, wedding_id=venue.wedding_id,
        venue=venue, website=website, saved_website=venue.website, candidates=candidates,
        expires_at=Now() + timedelta(seconds=PREVIEW_TTL),
    )
    return {
        "metadata": {**metadata, "images": images},
        "preview_token": token,
        "expires_in": PREVIEW_TTL,
    }


def consume_selection(*, user_id, venue, token, images):
    """Verify and consume candidates inside the same transaction as the image writes."""
    preview = VenueImagePreview.objects.select_for_update().filter(
        token_hash=hash_preview_token(token), user_id=user_id, wedding_id=venue.wedding_id,
        venue=venue, saved_website=venue.website, expires_at__gt=Now(),
    ).first()
    if preview is None:
        raise PreviewError("invalid_preview", "A current preview for this venue is required.", 400)

    selected = {}
    for image in images:
        url = image["image_url"]
        candidate = preview.candidates.get(url)
        if candidate is None or image.get("source_url", candidate["source_url"]) != candidate["source_url"]:
            raise PreviewError("unverified_image", "Select images and sources from the verified preview.", 400)
        selected.setdefault(url, {
            "image_url": url,
            "source_url": candidate["source_url"],
            "alt_text": image.get("alt_text", candidate["alt_text"]),
        })
    used = set(preview.used_image_urls)
    unused = [image for url, image in selected.items() if url not in used]
    if unused:
        preview.used_image_urls.extend(image["image_url"] for image in unused)
        preview.save(update_fields=["used_image_urls"])
    return unused
