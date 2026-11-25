# Wedding budget API

All routes below are relative to `/api/weddings/{wedding_id}/budget/`.
Django session authentication and the standard CSRF cookie/header apply. A missing
wedding, an inaccessible wedding, or a missing/foreign category or quote returns 404.

| Method | Route | JSON body | Success |
| --- | --- | --- | --- |
| GET | `/` | — | 200 budget snapshot |
| PATCH | `/` | `{"total_budget":"50000.00"}`, `{"category_ids":[4,2]}`, or both | 200 budget snapshot |
| POST | `categories/` | `{"name":"Photography","planned_amount":"4000.00","estimated_cost":null}` | 201 budget snapshot |
| PATCH | `categories/{category_id}/` | Any subset of `name`, `planned_amount`, `estimated_cost` | 200 budget snapshot |
| DELETE | `categories/{category_id}/` | — | 200 budget snapshot |
| POST | `venue-simulation/` | `{"quote_id":12,"expected_guests":280}` | 200 simulation |

Use decimal strings with up to 10 whole digits and up to 2 fractional digits
for writable amounts. Negative inputs are rejected. Money in responses uses
exactly two decimal places. The currency is ILS. Category names are trimmed and
limited to 100 characters. Omitting `estimated_cost` on create defaults to
`null`; on edit, send `null` explicitly to clear it. The budget supports up to
100 categories. Reorder requests must contain every current category ID once.
New categories append, and deletion compacts the zero-based positions. Category
writes are serialized per wedding in PostgreSQL.

A budget snapshot has these fields:

- `currency`, `total_budget`, `allocated_budget`, `estimated_spending`,
  `unallocated_budget`, `estimated_remaining_budget`
- `missing_estimate_count` (integer) and `categories` (ordered array of
  `id`, `name`, `planned_amount`, `estimated_cost`, `position`)
- `attendee_summary` with `attendees`, `adult_count`, `child_count`,
  `infant_count` and `unclassified_count` (active guest records only)

Allocated budget sums planned amounts. Estimated spending sums recorded estimates
and excludes categories without estimates. Both remaining balances subtract their
respective sum from the total and may be negative. An untouched wedding returns
an empty budget without creating a database row. Guest counts are computed from
guest records at request time. Guest age counts use the adults-by-default policy.
The legacy `unclassified_count` response field is zero.

The simulation returns `expected_guests`, `quote_id`, `venue_id`, `venue_name`,
`event_date`, `minimum_guests`, `price_per_guest`, `billable_guests`, `meals_cost`,
`additional_costs`, and `total_cost`. It uses the existing quote comparison
calculation: the higher of expected guests and minimum guests is billed at the
quote's single per-guest rate, then additional costs are added. It does not
persist a simulation or modify the quote or budget. Estimates and simulations are
planning figures, separate from payments.

Apply with `python manage.py migrate`. The migration is
`weddings.0009_wedding_budget`.

## Commitments and payment schedule

These routes are relative to the same budget URL and use the same permissions.
Successful writes return the same snapshot as the list endpoint, with 201 for
creation and 200 for updates and deletions.

| Method | Route | JSON fields |
| --- | --- | --- |
| GET | `expenses/` | — |
| POST | `expenses/` | Required `category_id`, `name`, `committed_cost`; optional `venue_id` or null, `supplier_name` |
| PATCH | `expenses/{expense_id}/` | Changed expense fields |
| DELETE | `expenses/{expense_id}/` | — |
| POST | `expenses/{expense_id}/payments/` | Required `phase`, `amount`; optional `due_date`, `notes`, `paid_amount`, `paid_date` |
| PATCH | `expenses/{expense_id}/payments/{payment_id}/` | Changed payment fields |
| DELETE | `expenses/{expense_id}/payments/{payment_id}/` | — |

IDs are JSON integers and must refer to the requested wedding. A supplier name
is an optional text label. Venue associations use saved venue IDs. Each
wedding can have up to 100 commitments, each with up to 30 scheduled payments.
The same decimal string contract applies. Payment amounts must be positive.
Phases are `deposit`, `before`, `on_day`, `after` and `other`.
Dates use ISO `YYYY-MM-DD` or null. Phase and wedding date never generate due dates.

A payment's `paid_amount` is the cumulative actual amount recorded for that
installment. `paid_date` is the date of its latest actual payment. Positive
paid amounts require a date no later than the server's current date. Zero
requires null. Corrections replace the previous record values. To reverse an
erroneous recording, send `{"paid_amount":"0.00","paid_date":null}`.
The paid amount cannot exceed the installment, and total paid for a
commitment cannot exceed its cost. This feature tracks manual records and
does not process money transfers or retain a separate transaction history.

The snapshot includes `currency`, `as_of`, `wedding_date`, `totals`, and
`expenses`. Expense rows return the input fields, `id`, `venue_name`,
`scheduled_amount`, `paid_amount`, `remaining_amount`, `schedule_difference`
(committed less scheduled), `schedule_status` (`incomplete`, `complete` or
`overallocated`), and `payments`. Payment rows return input fields, `id`,
`status` (`unpaid`, `partial` or `paid`), `outstanding_amount`, and `timing`
(`upcoming`, `overdue` or null).

Totals return `committed_cost`, `scheduled_amount`, `paid_amount`,
`remaining_amount`, `upcoming_amount`, and `overdue_amount`. Remaining payable
is commitment less actual paid. Timing totals include only outstanding amounts
with a due date. Today and later count as upcoming; dates before today count
as overdue. Dates are compared in Django's configured timezone. Due-date
totals may differ from the payable balance when a schedule is incomplete or
overallocated. Neither scheduled payments nor category estimates count as paid.

Remove or move commitments before deleting a category. Remove scheduled
payments before deleting a commitment. An installment with a positive actual
payment must be explicitly corrected before it can be deleted.

Apply migration `weddings.0010_budget_expenses_and_payments` with
`python manage.py migrate`.
