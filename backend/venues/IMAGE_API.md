# Venue metadata preview and images

All routes use Django session authentication and require the CSRF token on
unsafe methods. A member must have access to the wedding and the nested venue.

| Method | Path under `/api/weddings/<wedding_id>/venues/<venue_id>/` | Contract |
| --- | --- | --- |
| POST | `metadata-preview/` | Send `{}` to use the saved website or `{"website":"https://venue.example.com/"}` to override it for this preview. Returns `metadata`, `preview_token`, and `expires_in`. |
| POST | `images/` | Send `{"preview_token":"…","images":[{"image_url":"https://venue.example.com/hall.jpg"}]}`. Select 1–20 URLs from `metadata.images`. Each selection may include `alt_text` (up to 255 characters) and `source_url` (must match the candidate). Returns the complete ordered `images` list with HTTP 200. |
| DELETE | `images/<image_id>/` | Removes the specified image and returns HTTP 204. |

JSON request bodies are limited to 96 KiB. Image and source URLs may be up to
500 characters. The API supplies the verified
source and uses the candidate alt text when the caller omits an override. A save
appends new images in request order and skips existing URLs. The first image
added to an empty venue is primary. Deleting an image leaves the remaining sort
positions and primary flags as saved. Image and text metadata are untrusted
website content. Clients must render text safely. Image candidates come from
the page and are not verified to exist or to serve image content.

A preview writes temporary PostgreSQL records. Venue and image records are
only changed by their write endpoints. The response includes an opaque,
random token. PostgreSQL stores its SHA-256 hash, the issuing user, wedding,
venue, preview website, saved website, allowed candidates, and expiration.
Keep the token out of client logs. Its lifetime is five minutes. Changing the
saved website invalidates the token while that URL differs.

A successful save consumes the selected candidates in the same transaction as
the image writes. During the token's lifetime, other candidates may still be
selected. Submitting a consumed candidate is a no-op, even if the image has
since been deleted. Request a new preview to re-add a deleted image. Import,
preview, and selection failures return an `error` object with a stable `code`
and a client-safe `message`. Request validation errors use Django REST
Framework's standard format.

## Deployment

Run `python manage.py migrate` before deploying the updated application.
All workers must share the same PostgreSQL database. Tokens issued before
the cutover expire from the client's perspective and require a fresh preview.
Apply the cutover to all workers together to avoid splitting the quota across
the old and new stores.

The limit is five network-triggering previews per user per fixed 60-second
window across all venues, including failed fetches. PostgreSQL supplies the
clock and serializes reservations for the same user and minute. The reservation
commits before website fetching starts. A 429 response includes `Retry-After`.
Fixed windows allow bursts across minute boundaries. If the reservation fails,
fetching does not start. The importer uses its existing fetch limits, and
image URLs are never downloaded or proxied by the server.

Schedule `python manage.py cleanup_venue_previews` from the backend directory
every five minutes using the deployment's scheduler and the same database
configuration as the web workers. For cron, use the backend virtual
environment's Python and the absolute path to `manage.py` in a `*/5 * * * *`
entry. The command is safe to rerun and deletes expired previews and rate
windows older than one hour. Expiration is checked on save even if cleanup
has not run.
