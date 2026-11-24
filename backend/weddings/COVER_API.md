# Private wedding covers

Apply migration `weddings.0005_wedding_cover_image` after installing the
backend requirements, including Pillow with WebP support. No existing wedding
needs a data migration.

| Method | Path | Request | Successful response |
| --- | --- | --- | --- |
| POST | `/api/weddings/{wedding_id}/cover/` | Multipart form with exactly one file in `cover` | HTTP 200 with `{"cover_image_url":"/api/weddings/{wedding_id}/cover/?v=<version>"}` |
| GET | `/api/weddings/{wedding_id}/cover/` | Use the returned URL with the session cookie | HTTP 200 with normalized `image/webp` bytes and private, no-store caching |
| DELETE | `/api/weddings/{wedding_id}/cover/` | Empty body | HTTP 200 with `{"cover_image_url":null}` |

Every operation requires a session-authenticated wedding member. POST and
DELETE require the existing Django CSRF header. Unknown and inaccessible
weddings return the same 404. GET also returns 404 when there is no saved
cover or its file is missing. Wedding create, list, detail, and invitation
acceptance responses include the additive, read-only `cover_image_url` field.

POST accepts a decodable, single-frame JPEG, PNG, or WebP up to 5 MiB and
20 million pixels. Orientation is applied before the image is resized to at
most 2560 pixels on its longest edge. Only a re-encoded WebP with metadata
stripped is stored. Errors include `invalid_upload`, `invalid_image`, and
`unsafe_dimensions` (400), `too_large` (413), and `storage_unavailable`
(503). Session and CSRF denials use the existing 403 response shape.

## Local and production storage

Locally, install dependencies with `python -m pip install -r requirements.txt`,
then run `python manage.py migrate`. Django writes to `backend/private-media`
by default and serves covers through the authenticated API. Docker and Redis
are unnecessary.

In production, set `DJANGO_PRIVATE_MEDIA_ROOT` to an absolute path on a
persistent private volume shared by every application worker. Give only the
application service and authorized operators access. Keep this directory
outside public web roots and static/media routes. Use same-origin HTTPS and
configure the reverse proxy to reject cover upload requests above 6 MiB,
allowing room for multipart overhead. Back up the database and private
storage together.

Replacement writes a new file before changing the database reference. After
commit, the previous file is deleted. Removing a cover or deleting the
wedding uses the same post-commit rule. A failed transaction removes its new
file when the database confirms it is unreferenced. A process crash, storage
outage, or ambiguous database commit can leave an orphaned file. If cleanup
errors are logged, reconcile old unreferenced files against the database
during a maintenance window with cover writes paused.

The frontend previews the selected file and uses responsive cover cropping.
Manual crop and positioning controls are outside this release.
