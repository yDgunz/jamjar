# Event Scheduling & Availability

**Date:** 2026-03-13
**Status:** Draft
**Roadmap item:** #11 (Show date coordination)

## Problem

Band groups need to coordinate rehearsal dates and potential gig dates. Currently this happens through group chat threads and one person manually collecting availability — a process that's chaotic and easy to lose track of.

## Solution

An event + RSVP system that lets group members create events (rehearsals or gigs), collect availability responses, and see at a glance who can make it.

## Data Model

### `events` table

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | auto-increment |
| group_id | FK → groups | CASCADE delete |
| type | TEXT NOT NULL | `rehearsal` or `gig` |
| name | TEXT NOT NULL | e.g., "Tuesday Practice", "Blues Fest Set" |
| date | TEXT NOT NULL | ISO date (2026-03-21) |
| time | TEXT | nullable, HH:MM 24-hour format (e.g., "19:00") |
| end_time | TEXT | nullable, HH:MM 24-hour format, must be after `time` if both set |
| location | TEXT | nullable |
| status | TEXT NOT NULL | `tentative`, `confirmed`, or `cancelled`, default `tentative` |
| notes | TEXT | nullable, free-form details |
| created_by | FK → users | SET NULL on delete |
| created_at | TEXT NOT NULL | DEFAULT datetime('now'), matches existing convention |

- Group-scoped, CASCADE delete with group.
- `type` constrained to `rehearsal` or `gig`.
- `status` constrained to `tentative`, `confirmed`, or `cancelled`.
- Index: `CREATE INDEX idx_events_group_date ON events(group_id, date)` for efficient listing.

### `event_responses` table

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | auto-increment |
| event_id | FK → events | CASCADE delete |
| user_id | FK → users | CASCADE delete |
| status | TEXT NOT NULL | `yes`, `no`, or `maybe` |
| comment | TEXT | nullable, e.g., "I'll be 30 min late" |
| responded_at | TEXT NOT NULL | DEFAULT datetime('now') |
| UNIQUE(event_id, user_id) | | one response per member per event |

### Implementation notes

- A new `get_users_for_group(group_id)` method is needed on the `Database` class to support listing all group members and computing "pending" counts for response summaries.
- The `Database.reset()` method must be updated to drop `event_responses` before `events` (FK dependency order).
- The seed script (`scripts/seed-db.py`) should be updated with sample events and responses.

## API Endpoints

All endpoints require authentication and group membership. Group scoping enforced via `_require_group_access()`.

### Events

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/events` | any member | List events for user's group(s), ordered by `date ASC, time ASC` (nearest first). Includes response summary counts (`{yes, no, maybe, pending}`) per event and the current user's response. Supports `?type=rehearsal\|gig` filter and `?include_past=true` (default: upcoming only). |
| POST | `/api/events` | editor+ | Create event. Required: `group_id`, `type`, `name`, `date`. Optional: `time`, `end_time`, `location`, `status`, `notes`. Follows the same pattern as `POST /api/setlists` — `group_id` in request body, validated via `_require_group_access()`. |
| GET | `/api/events/{id}` | any member | Event detail with full member response list (including pending members who haven't responded). |
| PUT | `/api/events/{id}` | editor+ | Partial update. Accepts any subset of: `name`, `type`, `date`, `time`, `end_time`, `location`, `status`, `notes`. Only provided fields are changed. This intentionally uses a single partial-update endpoint rather than the per-field PUT pattern used by older resources (see roadmap item #14 for planned consolidation of those). |
| DELETE | `/api/events/{id}` | admin | Delete event and all responses. |

### Responses

| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/api/events/{id}/respond` | any member | Set RSVP. Body: `{status: "yes"\|"no"\|"maybe", comment?: "..."}`. Upserts (creates or updates existing response). |
| DELETE | `/api/events/{id}/respond` | any member | Clear your RSVP. |

**Note on readonly users:** RSVP endpoints allow any group member including `readonly` users. This is an intentional exception to the usual pattern where `readonly` cannot modify data — responding to availability is a personal action, not content editing.

### Validation rules

- `time` and `end_time`: must be HH:MM 24-hour format (regex: `^\d{2}:\d{2}$`). Return 422 if invalid.
- If both `time` and `end_time` are provided, `end_time` must be after `time`. Return 422 if not.
- `date`: must be valid ISO date (YYYY-MM-DD). Return 422 if invalid.
- `type`: must be `rehearsal` or `gig`. Return 422 if invalid.
- `status`: must be `tentative`, `confirmed`, or `cancelled`. Return 422 if invalid.

### Response summary format

The `GET /api/events` list includes a summary per event:

```json
{
  "id": 1,
  "type": "rehearsal",
  "name": "Tuesday Practice",
  "date": "2026-03-21",
  "time": "19:00",
  "location": "Dave's garage",
  "status": "confirmed",
  "response_summary": {"yes": 3, "no": 1, "maybe": 0, "pending": 1},
  "my_response": {"status": "yes", "comment": null}
}
```

## Frontend

### Navigation

Add "Schedule" to the main nav between Setlists and Tools, in both desktop nav and mobile bottom bar. Calendar icon.

### Routes

- `/schedule` — event list
- `/schedule/{id}` — event detail

### List view (`/schedule`)

- Chronological list of upcoming events, ordered nearest-first, grouped by month
- Each event card shows:
  - Type badge (rehearsal / gig)
  - Name, date/time, location
  - Status badge (tentative / confirmed / cancelled)
  - Response summary (e.g., "3 yes, 1 no, 1 pending")
  - Your current RSVP status
  - Quick RSVP buttons (yes / no / maybe) directly on the card
- "New Event" button visible for editor+ roles
- Filter by type (all / rehearsal / gig)
- Past events hidden by default, "Show past" toggle to reveal
- Empty state: "No upcoming events. Create one to get started."

### Event detail view (`/schedule/{id}`)

- Full event info: name, type, date, time, location, status, notes
- Edit controls for editor+ roles (inline editing, matching existing UI patterns)
- Your RSVP section: yes/no/maybe buttons + comment text field
- Member response list:
  - Each group member listed with their response status and comment
  - Members who haven't responded shown as "Pending"
  - Sorted: yes first, then maybe, then pending, then no
- Delete button for admin roles

### Design notes

- Follows existing dark-mode, gray-950 background, Tailwind styling
- Type badges: use accent color for gigs, neutral for rehearsals
- Status badges: green-tinted for confirmed, yellow-tinted for tentative, red-tinted for cancelled
- RSVP buttons: filled style for selected state, outline for unselected

## Roles & Permissions

| Action | Required role |
|--------|--------------|
| View events and responses | any group member |
| Create event | editor+ |
| Edit event | editor+ |
| Delete event | admin |
| Set/clear own RSVP | any group member (including readonly — see note above) |

## Activity logging

Log these events to `activity_log`:
- `event_created` — when an event is created
- `event_updated` — when event details change
- `event_deleted` — when an event is deleted
- `event_response` — when a member RSVPs (include status in detail)

## Future enhancements (not in v1)

- **SMS notifications** — Twilio integration to send RSVP requests and reminders via text. Add `phone` column to `users` table at that time.
- **Calendar view** — Month-at-a-glance toggle alongside the list view.
- **Date polling** — Doodle-style flow: propose multiple candidate dates, members vote, winning date becomes the event.
- **Setlist linking** — Associate a setlist with a gig event (nullable `setlist_id` FK on events).
- **Recurring events** — "Repeat weekly" to auto-create rehearsal events on a cadence.
- **iCal export** — Subscribe to group events from an external calendar app.
