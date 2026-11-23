# Venue quote comparison

`POST /api/weddings/<wedding_id>/venues/compare/`

Send JSON with the authenticated session cookie and the usual Django CSRF
header. The request accepts exactly two fields, with a 4 KiB body limit.

```json
{"expected_guests": 280, "quote_ids": [1, 2]}
```

`expected_guests` must be a positive JSON integer. `quote_ids` must contain
2–4 distinct positive integer IDs within the signed PostgreSQL bigint range.
Each quote must belong to the wedding in the URL. Multiple quotes for the
same venue are allowed.

## HTTP 200 response

```json
{
  "expected_guests": 280,
  "comparisons": [
    {
      "quote_id": 2,
      "venue_id": 8,
      "venue_name": "Orchard",
      "event_date": "2027-05-03",
      "minimum_guests": 280,
      "price_per_guest": "100.25",
      "additional_costs": "0.05",
      "notes": "",
      "billable_guests": 280,
      "meals_cost": "28070.00",
      "total_cost": "28070.05",
      "difference_from_cheapest": "0.00"
    },
    {
      "quote_id": 1,
      "venue_id": 8,
      "venue_name": "Orchard",
      "event_date": "2027-05-02",
      "minimum_guests": 300,
      "price_per_guest": "100.10",
      "additional_costs": "12.34",
      "notes": "",
      "billable_guests": 300,
      "meals_cost": "30030.00",
      "total_cost": "30042.34",
      "difference_from_cheapest": "1972.29"
    }
  ],
  "cheapest_quote_id": 2,
  "cheapest_quote_label": "Lowest known calculated cost"
}
```

Dates use `YYYY-MM-DD` or `null`. Monetary fields are decimal strings with
exactly two fractional digits. Billable guests are the greater of expected
guests and the quote minimum. Meals cost is billable guests multiplied by the
saved price per guest. Total cost adds the saved additional costs.

Rows sort by total cost and then by quote ID, both ascending. The first row
supplies `cheapest_quote_id`. Equal lowest totals all have a difference of
`"0.00"`. The label describes the lowest calculated cost among the submitted
quotes. Venue suitability is outside the comparison. Calculations use only
saved prices and additional costs, with no inferred taxes, discounts, or fees.
The request does not write venue or quote records.

## Errors

- `400` for invalid fields, malformed JSON, or an oversized body.
- `403` for missing authentication or failed CSRF.
- `404` with `{"detail":"Not found."}` if the wedding or any requested quote
  is missing or outside the permitted scope.
- `415` for unsupported content types.

Session CSRF handling can reject malformed JSON before the wedding lookup.
