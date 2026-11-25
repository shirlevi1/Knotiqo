# Wedding meetings API

Apply migration `weddings.0013_wedding_meetings` using `python manage.py migrate`.
All routes use Django sessions, CSRF for writes, and wedding membership.
An inaccessible wedding, meeting or submitted relationship returns the same
404 as a missing resource.

Base URL: `/api/weddings/{wedding_id}/meetings/`.

| Method | Route suffix | Result |
| --- | --- | --- |
| GET | base | Paginated meetings (`count`, `next`, `previous`, `results`) |
| POST | base | Create a meeting, 201 |
| GET | `{meeting_id}/` | Read a meeting |
| PATCH | `{meeting_id}/` | Update a meeting. Use `{"status":"cancelled"}` to retain it in the calendar as cancelled. |
| DELETE | `{meeting_id}/` | Remove a meeting, 204 |
| GET | `dates/` | Sorted distinct local dates with matching meetings, with both date bounds required (at most 367 inclusive days) |
| GET | `options/` | Same-wedding venue and vendor choices as `{kind,id,name}` |
| GET | `upcoming/?scope=dashboard\|venues\|vendors` | Next five scheduled meetings for the dashboard, or the next scheduled meeting per venue/vendor |

List and dates query parameters: `date_from`, `date_to` (inclusive ISO local
dates), `venue_id`, `vendor_id`, `meeting_type`, and `status`. The list is
ordered by start time and ID and uses 100 meetings per page.

Example create request:

```json
{
  "title": "סיור באולם",
  "meeting_type": "venue_tour",
  "date": "2027-07-01",
  "start_time": "16:30",
  "end_time": "17:15",
  "venue_id": 12,
  "location": "כתובת הפגישה"
}
```

Required on create: `title`, `meeting_type`, `date`, `start_time`. Types are
`venue_tour`, `in_person`, `phone`, `video`, `fitting`, and `other`. Optional
fields: `end_time` (null to omit), `venue_id` or `vendor_id` (both null or
omitted for a general appointment), `contact_person`, `phone`, `location`,
`video_url`, `notes`, and `status` (`scheduled` by default, `completed`, or
`cancelled`). When switching association on PATCH, clear the old relationship
and set the new one in the same request. Deleting a referenced venue or vendor
preserves its meetings as general appointments.

Responses include the writable fields, `id`, nullable `venue_name` and
`vendor_name`, and timezone-aware `starts_at` and `ends_at`. Date and time fields
use Asia/Jerusalem wall time. PostgreSQL stores timezone-aware instants.
An end time must be after the start on the same local date. Ambiguous and
nonexistent local times during daylight-saving transitions return 400.

The workspace route is `#/weddings/{id}/meetings`. Venue and vendor shortcuts
preselect the relevant record. The month and agenda use Gregorian dates with
Hebrew labels and Sunday as the first day. Native date and time inputs follow
browser and operating system locale settings. This version does not send
notifications or create public calendar links.

## Meetings dashboard

The list and dates endpoints also accept `association=venue|vendor|general`,
`search` (title or associated business name, up to 150 characters), and
`upcoming=true` (future scheduled meetings only). Existing filters still work.
On the list endpoint, `summary=1` returns `{"count": number, "first": meeting|null}`
for the requested filters without loading an appointment page.

Meeting responses include `venue_details` or `vendor_details` when associated.
These contain the saved business contact fields and, for venues, location and
the primary image URL and alt text. The dashboard labels business contacts as
fallbacks and prioritizes meeting-specific details. The options response includes
the saved venue location where available so a booking shortcut can suggest it.

The dashboard keeps completed and cancelled meetings available in date and status
views. The three existing statuses are unchanged. No new migration is needed
for this dashboard enhancement. Run `npm run build` in `frontend` before opening
the updated page with the Windows desktop launcher.
