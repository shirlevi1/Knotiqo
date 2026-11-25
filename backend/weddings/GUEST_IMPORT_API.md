# Excel guest import

All routes are POST under `/api/weddings/{wedding_id}/guests/import/`. Use a
Django session cookie and the usual CSRF header. A session is private to its
creator and wedding, including when that wedding has two members.

| Route suffix | Request | Response |
| --- | --- | --- |
| Empty | Multipart with exactly one `.xlsx` file named `workbook` | 201 with `session_id`, `expires_at`, and `worksheets` |
| `{session_id}/preview/` | JSON with `worksheet` and `mapping` | 200 with `preview_id`, `worksheet`, `rows`, and `unmapped_columns` |
| `{session_id}/confirm/` | JSON with `preview_id` and `decisions` | 200 with `created`, `skipped`, `updated`, and `restored` counts |

## Inspect and preview

A worksheet entry contains its `name` and `columns`. Each column has a
one-based `column` number, a `heading` from row 1 (possibly empty), and a
`suggested_field` or `null`. Suggestions match common Hebrew and English
headings. Choose a sheet and send the validated mapping, for example:

```json
{"worksheet":"מוזמנים","mapping":{"full_name":3,"phone":1,"party_size":2}}
```

`full_name` is required. Optional fields are `phone`, `email`, `side`,
`category`, `party_size`, `adult_count`, `child_count`, `infant_count`,
`family_group`, and `notes`. Map each column at
most once. Blank optional cells are omitted so an update preserves the
existing value. New guests use the model defaults for omitted fields.

For new guests, a total-only row is previewed and saved as all adults.
If the total is provided with children or infants and the adult cell is
blank, adults are the remainder. Explicit age counts take precedence and
must match the supplied total. In a row with explicit age inputs, blank
child and infant cells count as zero for creation. On update or restore,
blank age cells preserve prior child and infant counts and the result is
validated against any supplied total. Without a total, supplied age counts
determine it. If neither quantity nor age is supplied, a new record defaults
to one adult.

A total-only update or restore preserves the saved age breakdown when the
total is unchanged or omitted. A different total without explicit age
inputs returns `guest_age_conflict` (409). The preview flags rows with
derived adult defaults using `age_defaulted`; these preview values are
only used for creation.

Every nonblank data row has its original Excel `row` number, mapped
`values`, field-keyed `errors` containing validation codes, and a list of
`warnings`. Rows with empty `errors` also have `duplicates`:

- `rows` contains other source row numbers and `matched_on` lists.
- `guests` contains same-wedding candidates with `id`, `full_name`, `phone`,
  `email`, `is_archived`, `updated_at`, and `matched_on`.

`matched_on` can contain `phone`, `email`, and `name`. Phone and email
matches rank ahead of name-only matches. Formatting punctuation is ignored
for phone matching, and email comparison is case-insensitive. The importer
does not infer country codes or missing leading zeros. Excel text and
simple zero-padded number formats preserve existing zeros. Unpadded numeric
phone cells emit `check_numeric_phone_leading_zeros`. Mapped formula and
unsupported cells are errors. Cached formula results and formula expressions
are discarded. A maximum of eight suggestions is returned per source, with
a warning if suggestions are truncated.

## Confirm

```json
{
  "preview_id": "891a8023-b6cd-4046-ba5a-cd8edfd64a3d",
  "decisions": [
    {"row": 2, "action": "create"},
    {"row": 3, "action": "skip"},
    {"row": 4, "action": "update", "guest_id": 45},
    {"row": 5, "action": "restore", "guest_id": 81}
  ]
}
```

Only explicitly listed rows are processed. Invalid rows can only be skipped.
For updates and restores, the target must have been offered for that row,
still be unchanged, and have the expected archive status. Targets and source
rows must each be distinct. Restore clears the archive flag and applies the
mapped values. Unmapped fields are preserved. The whole batch commits or
rolls back together. The server reads mapped values from the saved preview.

Re-previewing invalidates the older revision. Repeating the same confirmed
decisions returns the original counts until the session expires, regardless
of decision order. A different request for a consumed session returns 409.
Uploading the same file again creates a separate session and still requires
explicit decisions.

## Errors, storage, and setup

Workbook and workflow errors use `{"error":{"code":"..."}}`. Common codes
include `invalid_workbook`, `invalid_mapping`, and
`invalid_selection` (400), `session_expired` (410), `file_size` or
`request_size` (413), `already_confirmed`, `stale_preview`, `guest_changed`,
and `guest_list_limit` (409), and `session_limit` (429). DRF handles schema
validation, authentication, CSRF, and generic 404s in the usual format.

Limits are 2 MiB upload, 8 MiB expanded ZIP (4 MiB per entry), 96 entries, eight worksheets,
500 data rows and 32 columns per sheet, 4,000 characters per cell, and
400,000 extracted characters per workbook. The 500-row limit counts
populated data rows, excluding the first heading row. Formatting-only rows
and cells do not consume that allowance. Populated data must be within rows
1–4,096 and columns 1–32. Worksheet XML is separately capped at 4,096 row
elements and 32,768 cell elements per sheet. Limit codes include
`workbook_package_limit`, `workbook_row_limit`, `workbook_row_position`, `workbook_column_limit`,
`workbook_metadata_limit`, `workbook_sheet_limit`, and `workbook_text_limit`
(400). Rejection logs carry rule names and numeric measurements without
workbook names or cell contents. Only standard OOXML workbooks
are supported. Macro-enabled packages, embedded objects, and external-workbook
parts are rejected. Matching is limited to wedding guest lists of 5,000
records including archived guests. The first row is always the heading row.
The parser checks a five-second time budget between parts and rows
(`workbook_timeout`, 422). This check cannot interrupt a single library call.
The transport body limits allow 64 KiB of multipart overhead and 128 KiB per
JSON request. Use corresponding reverse-proxy caps in production.

Preview marks recognized repeated headings and summary or section labels in
the mapped name column with `non_guest_row`. Later rows carry
`review_section_boundary` so the wizard excludes them from bulk selection.
Review those rows individually. Custom section text can resemble a name,
so preview and explicit confirmation remain necessary.

Install `python -m pip install -r requirements.txt` and apply
`python manage.py migrate` to install `weddings.0007_guest_import_session`.
No original workbook is retained by the application. PostgreSQL stores
parsed cells and previews for up to 30 minutes of access. Successful
confirmation immediately clears cells and previews, retaining only the
idempotency digest and counts. Run `python manage.py cleanup_guest_imports`
periodically (for example every five minutes) to physically purge expired
sessions. There are up to eight unexpired sessions per wedding. Restrict
database and backup access for this temporary guest data.
