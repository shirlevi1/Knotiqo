# Wedding planning journey

Apply `weddings.0014_journey_task` with `python manage.py migrate`.
No new package or background service is needed.

All routes below use the base `/api/weddings/{wedding_id}/journey/` and
require a wedding member's authenticated Django session. Writes use the
existing CSRF cookie and header. Missing or inaccessible resources return 404.

| Method | Suffix | Behavior |
| --- | --- | --- |
| GET | base | Journey snapshot with six ordered stages and task records |
| GET | `?summary=1` | Progress, recommendation and next actions without the stage list |
| POST | base | Create a custom task and return the updated snapshot, 201 |
| PATCH | `tasks/{key}/` | Update a task and return the updated snapshot |
| DELETE | `tasks/{key}/` | Delete a custom task and return the updated snapshot |

Create requires `title` (150 characters) and `stage` (integer 1–6).
Optional fields are `description` (1,000 characters), `status` (`open`, `done`,
`skipped`), `priority` (`normal`, `high`) and `due_date` (ISO date or null).
Default tasks allow status, priority and due-date edits. Custom tasks also
allow title, description and stage edits. Send `{"move":"up"}` or
`{"move":"down"}` alone to move a custom task within its stage. A wedding
can have 100 custom tasks.

Snapshots include `wedding_date`, `as_of`, `recommended_stage`,
`recommended_stage_title`, `progress` and `next_actions`. Progress includes
`completed`, applicable `total`, `skipped` and a rounded integer `percentage`.
The percentage is null when every task is skipped. Each task includes stable
`key`, stage, title, description, status, priority, date, `custom`, `overdue`,
`module` and `has_evidence`.

The 40 default tasks are defined in `journey_defaults.py` with stable keys.
Untouched defaults are composed on read. The first edit persists a row with
a unique wedding/key pair, so loading or retrying the journey cannot multiply
tasks. Completion is manual. Existing wedding data supplies evidence hints
only. A venue marked booked can inform the early recommendation. A venue
record, a quote or a generated RSVP link cannot complete a task.

Recommendations are based on the wedding date using Asia/Jerusalem. With
more than 183 days to go, a venue explicitly marked booked suggests stage 2
and otherwise stage 1. At 183–31 days the recommendation is stage 3, at 30–8
days stage 4, at 7–1 days stage 5 and from the wedding day stage 6. With no
date, the recommendation is null and all stages are available. Recommendations
never alter progress. Next actions prioritize overdue items, the recommended
stage, high priority and earliest saved due dates. Only an open task with an
explicit due date before today is overdue.

The UI links to the real wedding modules. RSVP tasks open guest management.
Payment tasks open the existing budget page. Seating and invitation preparation
and sending are manual milestones. Rebuild the frontend with `npm run build`
before opening new UI updates through the one-click Windows launcher.

## Progressive feature discovery

Apply `weddings.0015_journey_feature_activation` with `python manage.py migrate`.
Full and summary snapshots now include a `features` object keyed by
`vendors`, `payments`, and `rsvp`. Each entry has boolean `visible`,
`activated`, `has_data`, and `recommended` fields. The flags contain no
vendor, guest, or financial details.

`POST /api/weddings/{wedding_id}/journey/features/{feature}/` activates a
supported feature and returns the updated summary. It requires membership and
CSRF, is idempotent, and returns 404 for unknown features. Activation is shared
by both partners and does not change checklist progress.

Vendors and payments are recommended after explicit venue booking (a booked
venue or a completed booking task), or from stage 2 onward. RSVP is recommended
from stage 4 onward. Existing vendor records, budget commitments, and saved RSVP
links or responses keep their corresponding entries visible independently of the
recommended stage. Explicitly activated entries stay visible. An unbooked venue
or quote does not count as booking. RSVP usage does not imply invitations were sent.

Always-available features and a tools directory live in the workspace navigation.
The payment and RSVP shortcuts open their existing budget and guest screens.
Features can still be opened by direct link. The UI keeps a directly opened
feature visible while it is active. Visibility never controls API access.
The Windows launcher uses the built frontend. Run `npm run build` after UI changes.
