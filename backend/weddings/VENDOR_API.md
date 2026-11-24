# Wedding vendors and quotes

Base URL is `/api/weddings/{wedding_id}/vendors/`. The existing session, CSRF and
wedding-membership checks apply. Unknown or out-of-scope resources return 404.

| Method | Relative route | Success |
| --- | --- | --- |
| GET / POST | base | Vendor list, 200 / 201 |
| GET / PATCH / DELETE | `{vendor_id}/` | Single vendor on GET, updated vendor list on writes |
| GET / POST | `{vendor_id}/quotes/` | Quote list on GET, updated vendor list on POST (201) |
| GET / PATCH / DELETE | `{vendor_id}/quotes/{quote_id}/` | Single quote on GET, updated vendor list on writes |
| POST | `{vendor_id}/commitments/` | Updated budget commitment snapshot, 200 for link or 201 for creation |
| DELETE | `{vendor_id}/commitments/{expense_id}/` | Updated budget commitment snapshot |

Vendor creation requires `name` and `service_category`. Category is a text field
that accepts custom names. Other fields are `contact_person`, `phone`, `email`,
`website`, `notes`, `status`, and nullable `budget_category_id`. Status defaults
to `researching`. Other values are `contacted`, `quote_received`, `shortlisted`,
`booked`, `rejected`, and `cancelled`. A vendor response includes `id` and
its `quotes`.

Quotes require `title` and `amount` (ILS decimal string). Optional fields are
`received_date` (ISO date or null), `included_services`, `excluded_services`,
`notes`, and `status` (`pending` by default, `selected`, or `rejected`).
Quote responses also include `id`. Quote status is independent of vendor status
and budget accounting. The limits are 100 vendors per wedding and 20 quotes per vendor.

To link an existing expense, submit `{"expense_id":12}`. Repeating the same
association preserves the existing expense and all scheduled and actual payments.
To create an expense from a selected quote, submit
`{"quote_id":8,"category_id":3,"confirmed":true}`. This explicitly copies the
quote amount into a new commitment. Further quote edits leave that amount
unchanged. One quote can be the source of only one existing commitment. Relinking
a commitment already associated with a different vendor or repeating a quote
conversion returns 409. Unlinking retains the expense and its payments.
A vendor with linked commitments cannot be deleted until those links are removed.

The budget expenses snapshot adds nullable `vendor_id` and `source_quote_id`
to expense rows, and a `vendor_totals` object keyed by vendor ID. Each entry has
`committed_cost`, `paid_amount`, and `remaining_amount` as decimal strings.
Vendors without commitments have no entry. Standalone expenses keep both IDs null
when created through the existing budget endpoint.

Apply migration `weddings.0011_wedding_vendors` with `python manage.py migrate`.
