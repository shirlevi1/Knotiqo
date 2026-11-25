# Personal RSVP links

## Setup and public deployment

Apply `weddings.0012_guest_rsvp` with `python manage.py migrate`. Leave
`PUBLIC_BASE_URL` unset for local use. The guest screen then explains why external
sharing is unavailable and the backend declines link creation. Existing local
and development authentication remain available.

For a future deployment, set `PUBLIC_BASE_URL` to the exact HTTPS origin of a
domain you control (no path, query, credentials or fragment). This setting
does not publish the app or verify DNS or TLS. A deployment must serve the
built frontend at the root and forward the same-origin RSVP and CSRF APIs over
HTTPS. Configure a production secret key, `DEBUG=False`, allowed hosts, secure
cookies and a trusted TLS proxy configuration so Django recognizes HTTPS.
Keep PostgreSQL private and existing wedding membership checks in place.
Verify the public flow from a separate device before sharing genuine invites.

Configure the proxy and application monitoring to omit RSVP request/response
bodies. Invitations are bearer credentials, so anyone with a copy can submit an
update for that invitation. Links use URL fragments to keep tokens out of initial
HTTP requests and standard URL access logs.

## API

`GET /api/weddings/{wedding_id}/guests/{guest_id}/rsvp-link/` requires wedding
membership and returns `sharing_enabled`, `link_active`, `expires_at` and
`response` (null or status, attendee count, nullable age counts, response time).
`POST` requires CSRF, issues a 30-day link and additionally returns `url` once
(201). New links revoke a previous link for that guest only. `DELETE` requires
CSRF and revokes the link without changing the response. Archiving a guest
revokes their link. Wrong wedding and guest IDs return 404. Plaintext tokens
are never stored.

`POST /api/rsvp/` takes JSON over the configured HTTPS origin. Get the CSRF
cookie first from `GET /api/auth/csrf/` and send `X-CSRFToken`. An account session
is optional. Both public actions send a token in JSON:

- `{"action":"read","token":"..."}` returns couple names, date, invited
  quantity, nullable age limits and the available options. No guest name,
  contact fields, invitation record ID or unrelated wedding information is returned.
- `{"action":"respond","token":"...","status":"attending","attendee_count":2}`
  records attendance for a group without age limits. For known ages send all
  three integer fields `adult_count`, `child_count`, `infant_count` in place of
  `attendee_count`. Values are capped by the guest record. For `declining` or
  `maybe`, omit all count fields. Success returns `{"saved":true}`.

Each guest has one response. Repeating the same submission leaves it unchanged.
A changed answer replaces that one record. The invitation quantity remains
separate from confirmed attendance. Organizers can see the last response in the
guest's sharing panel. Guests may submit an updated answer while the link is active.

Unknown, expired and revoked links all return the same `404 invalid_link`.
PostgreSQL enforces fixed-window limits of 120 requests per connection address
and 12 per valid invitation per minute. The application does not trust forwarded
IP headers. With a reverse proxy, multiple clients may share the address
limit unless the deployment provides trusted client identity to the WSGI
server. Run `python manage.py cleanup_rsvp_rates` daily and add ingress request
limits before public rollout.

The organizer edits and previews a message, then copies the link or clicks a
standard WhatsApp link. Sending happens manually in WhatsApp. Phone targeting
is optional and uses an explicitly international number when one is available.
