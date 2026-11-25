# Wedding guests

All endpoints require a Django session and membership in the wedding in the
URL. Writes also require the normal CSRF header. Missing or inaccessible
weddings and guest IDs return the same 404 response.

| Method | Path | Response |
| --- | --- | --- |
| GET | `/api/weddings/{wedding_id}/guests/` | 200, paginated list with a summary |
| POST | `/api/weddings/{wedding_id}/guests/` | 201, created record |
| GET | `/api/weddings/{wedding_id}/guests/{guest_id}/` | 200, record including archived guests |
| PATCH | `/api/weddings/{wedding_id}/guests/{guest_id}/` | 200, updated record. Send `{"is_archived":false}` to restore |
| DELETE | `/api/weddings/{wedding_id}/guests/{guest_id}/` | 204, archives the record. Repeating the request is safe |

Writable JSON fields are `full_name` (required on create), `phone`, `email`,
`side` (`bride`, `groom`, `joint`, `unassigned`), `category` (`adult`,
`child`, `infant`), `family_group`, `tags` (up to 20 strings, 40 characters
each), `party_size`, `adult_count`, `child_count`, `infant_count`, `notes`,
and `is_archived`. The default side is
`unassigned`, category is `adult`, party size is 1, and archive status is
false. Phone and email can be blank. The response adds `id`,
`unnamed_companions`, `unclassified_count`, `created_at`, and `updated_at`.

Guests created with a total and no age counts default to that many adults,
with zero children and infants. If child or infant counts are given with a
total, omitting `adult_count` derives the adults as the remainder. If all
three counts are supplied, their sum determines the total. A supplied total
must agree. Negative counts, excess children or infants, and zero-person
groups are rejected. Unrelated edits preserve the saved breakdown. Changing
only the total of a mixed-age party requires age inputs.

Migration `weddings.0016_guest_adult_defaults` converts historical records
with all three counts null to adults by default, per the requested planning
assumption. It preserves party sizes, historical categories, and explicit
breakdowns, including archived records. The former unknown composition
cannot be inferred from those records after migration. The database now
requires all counts and enforces their sum. `unclassified_count` stays in
responses for compatibility and is zero.

A record represents one named guest. `party_size` includes that guest and
their unnamed companions. For example, a party size of 3 counts one record,
three attendees, and two unnamed companions. When a companion becomes a
separate named guest, reduce the original party size by one to count that
person once. Companions share the record's side for headcounts. The
`category` filter matches records with a positive known count for that age
group. The historical `category` value is retained for compatibility and export.

List query parameters are `search` (case-insensitive substring of name or
stored phone), `side`, `category`, `archive` (`active` by default,
`archived`, or `all`), `page`, and `page_size` (25 by default, maximum 100).
The response contains `count`, `next`, `previous`, `results`, and a
`summary` across all filtered pages. Summary keys are `records`,
`attendees`, `unnamed_companions`, `bride`, `groom`, `joint`, and
`unassigned`, plus `adult_count`, `child_count`, `infant_count`, and
`unclassified_count`. The three age counts sum to `attendees`. Side counts are attendee counts.

Apply `python manage.py migrate` to create the guest table with migration
`weddings.0006_guest` and add age counts with `weddings.0008_guest_age_counts`.
See [Excel guest import](GUEST_IMPORT_API.md) for the
separate upload, preview, and confirmation API.

## Excel downloads

Both endpoints require an authenticated wedding member. Missing and
inaccessible weddings return the same 404. An unauthenticated request returns
403. On success both return 200, the XLSX content type
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
`Content-Disposition: attachment`, and private, no-store caching.

| Method and path | Query | Attachment |
| --- | --- | --- |
| GET `/api/weddings/{wedding_id}/guests/template/` | None | `knotiqo-guest-template.xlsx` |
| GET `/api/weddings/{wedding_id}/guests/export/` | `archive=active` (default), `archived`, or `all` | `knotiqo-guests.xlsx` |

The template starts with a blank `מוזמנים` sheet. Its Hebrew headings
map to `full_name`, `phone`, `email`, `side`, `category`, `party_size`,
`adult_count`, `child_count`, `infant_count`, `family_group`, and `notes`.
The separate `הוראות` sheet has no data rows.

Export uses the same column order, followed by tags as JSON text and archive
status as `כן` or `לא`. Side and category use the existing enum values.
Records without a breakdown export blank age cells and keep their total.
An empty list returns headings only. Phones and other text fields use explicit
XLSX string cells to preserve leading zeros and prevent formula execution.
Characters that XML cannot represent are replaced with the Unicode replacement
character. Ownership and internal identifiers are excluded.

An invalid archive filter returns a standard 400 validation response. If
export exceeds 5,000 rows or four million text characters, it returns 422
with `{"error":{"code":"export_limit"}}`. Exports above the separate importer
limits must be split before re-import. Tags and archive status are export-only.
