# Event Scheduling & Availability Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an event scheduling and RSVP system so band groups can coordinate rehearsal and gig dates with member availability tracking.

**Architecture:** Two new DB tables (`events`, `event_responses`) following the existing group-scoped pattern. Eight new API endpoints with a consolidated partial-update PUT. Two new frontend pages (list + detail) matching existing Tailwind/dark-mode styling.

**Tech Stack:** Python/FastAPI, SQLite, React/TypeScript/Tailwind, pytest

**Spec:** `docs/superpowers/specs/2026-03-13-event-scheduling-design.md`

---

## File Structure

### Backend
| File | Action | Responsibility |
|------|--------|---------------|
| `src/jam_session_processor/db.py` | Modify | Add `events` + `event_responses` tables, dataclasses, CRUD methods, `get_users_for_group()` |
| `src/jam_session_processor/api.py` | Modify | Add Pydantic models, 8 endpoints, helper functions |
| `tests/test_api.py` | Modify | Add event CRUD, RSVP, permissions, and scoping tests |
| `scripts/seed-db.py` | Modify | Add sample events and responses |

### Frontend
| File | Action | Responsibility |
|------|--------|---------------|
| `web/src/api.ts` | Modify | Add Event/EventResponse types + API methods |
| `web/src/App.tsx` | Modify | Add Schedule nav item + routes |
| `web/src/pages/ScheduleList.tsx` | Create | Event list page with RSVP, filters, create modal |
| `web/src/pages/ScheduleDetail.tsx` | Create | Event detail with member responses, inline edit |

---

## Chunk 1: Database Layer

### Task 1: Add Event and EventResponse dataclasses

**Files:**
- Modify: `src/jam_session_processor/db.py:232-249` (after SetlistSong, before ShareLink)

- [ ] **Step 1: Add dataclasses after `SetlistSong` (line 230)**

Add these dataclasses between `SetlistSong` and `ShareLink`:

```python
@dataclass
class Event:
    id: int
    group_id: int
    type: str
    name: str
    date: str
    time: str | None
    end_time: str | None
    location: str | None
    status: str
    notes: str
    created_by: int | None
    created_at: str
    updated_by: int | None = None
    updated_at: str | None = None


@dataclass
class EventRSVP:
    user_id: int
    user_name: str
    user_email: str
    status: str
    comment: str | None
    responded_at: str | None
```

- [ ] **Step 2: Verify no syntax errors**

Run: `python -c "from jam_session_processor.db import Event, EventRSVP; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/jam_session_processor/db.py
git commit -m "feat(db): add Event and EventResponse dataclasses"
```

---

### Task 2: Add events and event_responses tables to schema

**Files:**
- Modify: `src/jam_session_processor/db.py:6` (SCHEMA string)

- [ ] **Step 1: Add table definitions to the end of the SCHEMA string**

Add before the closing `"""` of SCHEMA:

```sql
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('rehearsal', 'gig')),
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT,
    end_time TEXT,
    location TEXT,
    status TEXT NOT NULL DEFAULT 'tentative' CHECK(status IN ('tentative', 'confirmed', 'cancelled')),
    notes TEXT NOT NULL DEFAULT '',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_group_date ON events(group_id, date);

CREATE TABLE IF NOT EXISTS event_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('yes', 'no', 'maybe')),
    comment TEXT,
    responded_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(event_id, user_id)
);
```

- [ ] **Step 2: Update `reset()` method — add new tables to drop order**

In the `reset()` method, add these two lines at the top of the DROP list (before `invite_tokens`):

```python
DROP TABLE IF EXISTS event_responses;
DROP TABLE IF EXISTS events;
```

- [ ] **Step 3: Verify schema creates cleanly**

Run: `python -c "from jam_session_processor.db import Database; import tempfile, pathlib; db = Database(pathlib.Path(tempfile.mkdtemp()) / 'test.db'); print('OK'); db.close()"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add src/jam_session_processor/db.py
git commit -m "feat(db): add events and event_responses tables"
```

---

### Task 3: Add `get_users_for_group()` DB method

**Files:**
- Modify: `src/jam_session_processor/db.py` (after `get_group_ids_for_user`, ~line 558)
- Test: `tests/test_api.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_api.py`:

```python
def test_get_users_for_group(client):
    db = api._db
    uid1 = db.create_user("a@test.com", hash_password("pw"), name="Alice", role="editor")
    uid2 = db.create_user("b@test.com", hash_password("pw"), name="Bob", role="editor")
    gid = db.create_group("TestBand")
    db.assign_user_to_group(uid1, gid)
    db.assign_user_to_group(uid2, gid)

    users = db.get_users_for_group(gid)
    assert len(users) == 2
    names = {u.name for u in users}
    assert names == {"Alice", "Bob"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_api.py::test_get_users_for_group -v`
Expected: FAIL with `AttributeError: 'Database' object has no attribute 'get_users_for_group'`

- [ ] **Step 3: Write the implementation**

Add after `get_group_ids_for_user()` in `db.py`:

```python
def get_users_for_group(self, group_id: int) -> list[User]:
    rows = self.conn.execute(
        """SELECT u.* FROM users u
           JOIN user_groups ug ON ug.user_id = u.id
           WHERE ug.group_id = ?
           ORDER BY u.name""",
        (group_id,),
    ).fetchall()
    return [User(**row) for row in rows]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_api.py::test_get_users_for_group -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/jam_session_processor/db.py tests/test_api.py
git commit -m "feat(db): add get_users_for_group method"
```

---

### Task 4: Add event CRUD methods to Database

**Files:**
- Modify: `src/jam_session_processor/db.py` (after setlist methods, ~line 1270)
- Test: `tests/test_api.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_api.py`:

```python
def test_db_create_and_get_event(client):
    db = api._db
    uid, gid = _create_user_and_group(db)
    eid = db.create_event(
        group_id=gid, type="rehearsal", name="Tuesday Practice",
        date="2026-03-21", time="19:00", end_time="21:00",
        location="Dave's garage", created_by=uid,
    )
    event = db.get_event(eid)
    assert event is not None
    assert event.name == "Tuesday Practice"
    assert event.type == "rehearsal"
    assert event.date == "2026-03-21"
    assert event.time == "19:00"
    assert event.location == "Dave's garage"
    assert event.status == "tentative"
    assert event.created_by == uid


def test_db_list_events(client):
    db = api._db
    uid, gid = _create_user_and_group(db)
    db.create_event(group_id=gid, type="rehearsal", name="Event A", date="2026-03-20", created_by=uid)
    db.create_event(group_id=gid, type="gig", name="Event B", date="2026-03-25", created_by=uid)

    events = db.list_events([gid])
    assert len(events) == 2
    # Ordered by date ASC
    assert events[0].name == "Event A"
    assert events[1].name == "Event B"

    # Filter by type
    events = db.list_events([gid], event_type="gig")
    assert len(events) == 1
    assert events[0].name == "Event B"

    # Upcoming only (exclude past)
    events = db.list_events([gid], upcoming_only=True, today="2026-03-22")
    assert len(events) == 1
    assert events[0].name == "Event B"


def test_db_update_event(client):
    db = api._db
    uid, gid = _create_user_and_group(db)
    eid = db.create_event(group_id=gid, type="rehearsal", name="Old Name", date="2026-03-21", created_by=uid)

    db.update_event(eid, name="New Name", status="confirmed", updated_by=uid)
    event = db.get_event(eid)
    assert event.name == "New Name"
    assert event.status == "confirmed"
    assert event.updated_by == uid
    assert event.updated_at is not None


def test_db_delete_event(client):
    db = api._db
    uid, gid = _create_user_and_group(db)
    eid = db.create_event(group_id=gid, type="rehearsal", name="Doomed", date="2026-03-21", created_by=uid)
    db.delete_event(eid)
    assert db.get_event(eid) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_api.py::test_db_create_and_get_event tests/test_api.py::test_db_list_events tests/test_api.py::test_db_update_event tests/test_api.py::test_db_delete_event -v`
Expected: FAIL

- [ ] **Step 3: Implement CRUD methods**

Add after the setlist methods in `db.py`:

```python
# ── Events ──────────────────────────────────────────────────────────

def create_event(
    self,
    group_id: int,
    type: str,
    name: str,
    date: str,
    time: str | None = None,
    end_time: str | None = None,
    location: str | None = None,
    status: str = "tentative",
    notes: str = "",
    created_by: int | None = None,
) -> int:
    cur = self.conn.execute(
        "INSERT INTO events (group_id, type, name, date, time, end_time,"
        " location, status, notes, created_by, updated_by)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (group_id, type, name, date, time, end_time, location, status,
         notes, created_by, created_by),
    )
    self.conn.commit()
    return cur.lastrowid

def get_event(self, event_id: int) -> Event | None:
    row = self.conn.execute(
        "SELECT * FROM events WHERE id = ?", (event_id,)
    ).fetchone()
    if not row:
        return None
    return Event(**row)

def list_events(
    self,
    group_ids: list[int] | None = None,
    event_type: str | None = None,
    upcoming_only: bool = False,
    today: str | None = None,
) -> list[Event]:
    if group_ids is not None and not group_ids:
        return []
    clauses: list[str] = []
    params: list = []
    if group_ids is not None:
        placeholders = ",".join("?" for _ in group_ids)
        clauses.append(f"group_id IN ({placeholders})")
        params.extend(group_ids)
    if event_type:
        clauses.append("type = ?")
        params.append(event_type)
    if upcoming_only:
        from datetime import date as date_cls
        d = today or date_cls.today().isoformat()
        clauses.append("date >= ?")
        params.append(d)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    rows = self.conn.execute(
        f"SELECT * FROM events{where} ORDER BY date ASC, time ASC",
        params,
    ).fetchall()
    return [Event(**row) for row in rows]

def update_event(self, event_id: int, updated_by: int | None = None, **fields):
    """Update event fields. Only keys present in fields are changed."""
    allowed = {"name", "type", "date", "time", "end_time", "location", "status", "notes"}
    to_update = {k: v for k, v in fields.items() if k in allowed}
    if not to_update:
        return
    to_update["updated_by"] = updated_by
    to_update["updated_at"] = "datetime('now')"
    sets = []
    params = []
    for k, v in to_update.items():
        if k == "updated_at":
            sets.append("updated_at = datetime('now')")
        else:
            sets.append(f"{k} = ?")
            params.append(v)
    params.append(event_id)
    self.conn.execute(
        f"UPDATE events SET {', '.join(sets)} WHERE id = ?", params,
    )
    self.conn.commit()

def delete_event(self, event_id: int):
    self.conn.execute("DELETE FROM events WHERE id = ?", (event_id,))
    self.conn.commit()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_api.py::test_db_create_and_get_event tests/test_api.py::test_db_list_events tests/test_api.py::test_db_update_event tests/test_api.py::test_db_delete_event -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/jam_session_processor/db.py tests/test_api.py
git commit -m "feat(db): add event CRUD methods"
```

---

### Task 5: Add event response DB methods

**Files:**
- Modify: `src/jam_session_processor/db.py` (after event CRUD)
- Test: `tests/test_api.py`

- [ ] **Step 1: Write the failing tests**

```python
def test_db_event_responses(client):
    db = api._db
    uid1 = db.create_user("a@test.com", hash_password("pw"), name="Alice", role="editor")
    uid2 = db.create_user("b@test.com", hash_password("pw"), name="Bob", role="editor")
    gid = db.create_group("TestBand")
    db.assign_user_to_group(uid1, gid)
    db.assign_user_to_group(uid2, gid)
    eid = db.create_event(group_id=gid, type="rehearsal", name="Practice", date="2026-03-21", created_by=uid1)

    # Set responses
    db.set_event_response(eid, uid1, "yes", comment="I'll bring snacks")
    db.set_event_response(eid, uid2, "maybe")

    responses = db.get_event_responses(eid)
    assert len(responses) == 2
    r1 = next(r for r in responses if r.user_id == uid1)
    assert r1.status == "yes"
    assert r1.comment == "I'll bring snacks"
    assert r1.user_name == "Alice"

    # Upsert — change response
    db.set_event_response(eid, uid2, "no", comment="Can't make it")
    responses = db.get_event_responses(eid)
    r2 = next(r for r in responses if r.user_id == uid2)
    assert r2.status == "no"
    assert r2.comment == "Can't make it"

    # Delete response
    db.delete_event_response(eid, uid1)
    responses = db.get_event_responses(eid)
    assert len(responses) == 1

    # Summary with all group members
    summary = db.get_event_response_summary(eid, gid)
    assert summary == {"yes": 0, "no": 1, "maybe": 0, "pending": 1}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_api.py::test_db_event_responses -v`
Expected: FAIL

- [ ] **Step 3: Implement response methods**

```python
def set_event_response(
    self, event_id: int, user_id: int, status: str, comment: str | None = None,
):
    self.conn.execute(
        "INSERT INTO event_responses (event_id, user_id, status, comment)"
        " VALUES (?, ?, ?, ?)"
        " ON CONFLICT(event_id, user_id)"
        " DO UPDATE SET status = excluded.status,"
        " comment = excluded.comment, responded_at = datetime('now')",
        (event_id, user_id, status, comment),
    )
    self.conn.commit()

def delete_event_response(self, event_id: int, user_id: int):
    self.conn.execute(
        "DELETE FROM event_responses WHERE event_id = ? AND user_id = ?",
        (event_id, user_id),
    )
    self.conn.commit()

def get_event_responses(self, event_id: int) -> list[EventRSVP]:
    rows = self.conn.execute(
        """SELECT er.user_id, u.name as user_name, u.email as user_email,
                  er.status, er.comment, er.responded_at
           FROM event_responses er
           JOIN users u ON u.id = er.user_id
           WHERE er.event_id = ?
           ORDER BY er.responded_at""",
        (event_id,),
    ).fetchall()
    return [EventRSVP(**row) for row in rows]

def get_event_response_summary(self, event_id: int, group_id: int) -> dict:
    member_count = self.get_group_member_count(group_id)
    row = self.conn.execute(
        """SELECT
              SUM(CASE WHEN status = 'yes' THEN 1 ELSE 0 END) as yes_count,
              SUM(CASE WHEN status = 'no' THEN 1 ELSE 0 END) as no_count,
              SUM(CASE WHEN status = 'maybe' THEN 1 ELSE 0 END) as maybe_count
           FROM event_responses WHERE event_id = ?""",
        (event_id,),
    ).fetchone()
    yes = row["yes_count"] or 0
    no = row["no_count"] or 0
    maybe = row["maybe_count"] or 0
    pending = member_count - yes - no - maybe
    return {"yes": yes, "no": no, "maybe": maybe, "pending": pending}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_api.py::test_db_event_responses -v`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pytest`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/jam_session_processor/db.py tests/test_api.py
git commit -m "feat(db): add event response methods (set, delete, get, summary)"
```

---

## Chunk 2: API Layer

### Task 6: Add event Pydantic models and helper functions

**Files:**
- Modify: `src/jam_session_processor/api.py` (after setlist models/helpers)

- [ ] **Step 1: Add Pydantic models**

Add after the setlist Pydantic models:

```python
class EventResponse(BaseModel):
    id: int
    group_id: int
    group_name: str = ""
    type: str
    name: str
    date: str
    time: str | None
    end_time: str | None
    location: str | None
    status: str
    notes: str
    created_by_name: str | None = None
    updated_by_name: str | None = None
    created_at: str = ""
    updated_at: str | None = None
    response_summary: dict | None = None
    my_response: dict | None = None


class EventMemberResponse(BaseModel):
    user_id: int
    user_name: str
    status: str
    comment: str | None
    responded_at: str | None


class CreateEventRequest(BaseModel):
    group_id: int
    type: str
    name: str
    date: str
    time: str | None = None
    end_time: str | None = None
    location: str | None = None
    status: str = "tentative"
    notes: str = ""


class UpdateEventRequest(BaseModel):
    name: str | None = None
    type: str | None = None
    date: str | None = None
    time: str | None = None
    end_time: str | None = None
    location: str | None = None
    status: str | None = None
    notes: str | None = None


class EventRSVPRequest(BaseModel):
    status: str
    comment: str | None = None
```

- [ ] **Step 2: Add helper functions**

```python
import re as _re

_TIME_RE = _re.compile(r"^\d{2}:\d{2}$")
_DATE_RE = _re.compile(r"^\d{4}-\d{2}-\d{2}$")
_VALID_EVENT_TYPES = {"rehearsal", "gig"}
_VALID_EVENT_STATUSES = {"tentative", "confirmed", "cancelled"}
_VALID_RSVP_STATUSES = {"yes", "no", "maybe"}


def _validate_event_fields(
    type: str | None = None,
    date: str | None = None,
    time: str | None = None,
    end_time: str | None = None,
    status: str | None = None,
):
    if type is not None and type not in _VALID_EVENT_TYPES:
        raise HTTPException(status_code=422, detail=f"type must be one of: {', '.join(_VALID_EVENT_TYPES)}")
    if date is not None and not _DATE_RE.match(date):
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD format")
    if time is not None and not _TIME_RE.match(time):
        raise HTTPException(status_code=422, detail="time must be HH:MM format")
    if end_time is not None and not _TIME_RE.match(end_time):
        raise HTTPException(status_code=422, detail="end_time must be HH:MM format")
    if time and end_time and end_time <= time:
        raise HTTPException(status_code=422, detail="end_time must be after time")
    if status is not None and status not in _VALID_EVENT_STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of: {', '.join(_VALID_EVENT_STATUSES)}")


def _event_response(event, request=None) -> EventResponse:
    db = get_db()
    group = db.get_group(event.group_id)
    d = event.__dict__.copy()
    d["group_name"] = group.name if group else ""
    d["created_by_name"] = db.get_user_name(d.pop("created_by", None))
    d["updated_by_name"] = db.get_user_name(d.pop("updated_by", None))
    d["response_summary"] = db.get_event_response_summary(event.id, event.group_id)
    d["my_response"] = None
    if request and request.state.user:
        responses = db.get_event_responses(event.id)
        my = next((r for r in responses if r.user_id == request.state.user.id), None)
        if my:
            d["my_response"] = {"status": my.status, "comment": my.comment}
    return EventResponse(**d)


def _get_event_with_access(db, event_id: int, request):
    event = db.get_event(event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    _require_group_access(request, event.group_id)
    return event
```

- [ ] **Step 3: Verify no syntax errors**

Run: `python -c "from jam_session_processor.api import app; print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add src/jam_session_processor/api.py
git commit -m "feat(api): add event Pydantic models and helpers"
```

---

### Task 7: Add event list and create endpoints

**Files:**
- Modify: `src/jam_session_processor/api.py`
- Test: `tests/test_api.py`

- [ ] **Step 1: Write the failing tests**

```python
def test_create_and_list_events(auth_client):
    client, uid, gid = auth_client
    resp = client.post("/api/events", json={
        "group_id": gid, "type": "rehearsal", "name": "Tuesday Practice",
        "date": "2026-03-21", "time": "19:00", "location": "Dave's garage",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Tuesday Practice"
    assert data["type"] == "rehearsal"
    assert data["date"] == "2026-03-21"
    assert data["time"] == "19:00"
    assert data["location"] == "Dave's garage"
    assert data["status"] == "tentative"
    assert data["group_name"] == "TestBand"
    assert data["response_summary"]["pending"] == 1  # 1 member, no responses

    # Create a second event
    client.post("/api/events", json={
        "group_id": gid, "type": "gig", "name": "Blues Fest",
        "date": "2026-04-05", "time": "20:00",
    })

    resp = client.get("/api/events?include_past=true")
    assert resp.status_code == 200
    events = resp.json()
    assert len(events) == 2
    # Ordered by date ASC
    assert events[0]["name"] == "Tuesday Practice"
    assert events[1]["name"] == "Blues Fest"


def test_list_events_type_filter(auth_client):
    client, uid, gid = auth_client
    client.post("/api/events", json={"group_id": gid, "type": "rehearsal", "name": "R1", "date": "2026-03-21"})
    client.post("/api/events", json={"group_id": gid, "type": "gig", "name": "G1", "date": "2026-03-22"})

    resp = client.get("/api/events?type=gig&include_past=true")
    assert len(resp.json()) == 1
    assert resp.json()[0]["name"] == "G1"


def test_create_event_validation(auth_client):
    client, uid, gid = auth_client

    # Invalid type
    resp = client.post("/api/events", json={"group_id": gid, "type": "party", "name": "X", "date": "2026-03-21"})
    assert resp.status_code == 422

    # Invalid time format
    resp = client.post("/api/events", json={"group_id": gid, "type": "gig", "name": "X", "date": "2026-03-21", "time": "7pm"})
    assert resp.status_code == 422

    # end_time before time
    resp = client.post("/api/events", json={
        "group_id": gid, "type": "gig", "name": "X", "date": "2026-03-21",
        "time": "20:00", "end_time": "19:00",
    })
    assert resp.status_code == 422

    # Empty name
    resp = client.post("/api/events", json={"group_id": gid, "type": "gig", "name": "  ", "date": "2026-03-21"})
    assert resp.status_code == 400
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_api.py::test_create_and_list_events tests/test_api.py::test_list_events_type_filter tests/test_api.py::test_create_event_validation -v`
Expected: FAIL

- [ ] **Step 3: Implement endpoints**

```python
@app.get("/api/events", response_model=list[EventResponse])
def list_events(request: Request, type: str | None = None, include_past: bool = False):
    db = get_db()
    group_ids = _get_group_ids(request)
    events = db.list_events(
        group_ids, event_type=type,
        upcoming_only=not include_past,
    )
    return [_event_response(e, request) for e in events]


@app.post("/api/events", response_model=EventResponse, status_code=201)
def create_event(req: CreateEventRequest, request: Request):
    db = get_db()
    _require_group_access(request, req.group_id)
    _require_role(request, "editor")
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Event name cannot be empty")
    _validate_event_fields(
        type=req.type, date=req.date, time=req.time,
        end_time=req.end_time, status=req.status,
    )
    user_id = request.state.user.id if request.state.user else None
    eid = db.create_event(
        group_id=req.group_id, type=req.type, name=name, date=req.date,
        time=req.time, end_time=req.end_time, location=req.location,
        status=req.status, notes=req.notes, created_by=user_id,
    )
    if request.state.user:
        db.log_activity(request.state.user.id, req.group_id, "event_created", name)
    event = db.get_event(eid)
    return _event_response(event, request)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_api.py::test_create_and_list_events tests/test_api.py::test_list_events_type_filter tests/test_api.py::test_create_event_validation -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/jam_session_processor/api.py tests/test_api.py
git commit -m "feat(api): add event list and create endpoints"
```

---

### Task 8: Add event detail, update, and delete endpoints

**Files:**
- Modify: `src/jam_session_processor/api.py`
- Test: `tests/test_api.py`

- [ ] **Step 1: Write the failing tests**

```python
def test_get_event(auth_client):
    client, uid, gid = auth_client
    resp = client.post("/api/events", json={"group_id": gid, "type": "gig", "name": "Show", "date": "2026-04-01"})
    eid = resp.json()["id"]

    resp = client.get(f"/api/events/{eid}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Show"


def test_get_event_not_found(auth_client):
    client, uid, gid = auth_client
    resp = client.get("/api/events/9999")
    assert resp.status_code == 404


def test_update_event(auth_client):
    client, uid, gid = auth_client
    resp = client.post("/api/events", json={"group_id": gid, "type": "rehearsal", "name": "Old", "date": "2026-03-21"})
    eid = resp.json()["id"]

    resp = client.put(f"/api/events/{eid}", json={"name": "New", "status": "confirmed", "location": "Studio B"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "New"
    assert data["status"] == "confirmed"
    assert data["location"] == "Studio B"
    assert data["updated_by_name"] is not None


def test_update_event_validation(auth_client):
    client, uid, gid = auth_client
    resp = client.post("/api/events", json={"group_id": gid, "type": "gig", "name": "X", "date": "2026-03-21"})
    eid = resp.json()["id"]

    resp = client.put(f"/api/events/{eid}", json={"type": "party"})
    assert resp.status_code == 422


def test_delete_event(auth_client):
    client, uid, gid = auth_client
    resp = client.post("/api/events", json={"group_id": gid, "type": "gig", "name": "Doomed", "date": "2026-03-21"})
    eid = resp.json()["id"]

    resp = client.delete(f"/api/events/{eid}")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    resp = client.get(f"/api/events/{eid}")
    assert resp.status_code == 404


def test_editor_cannot_delete_event(client):
    db = api._db
    gid = db.create_group("Band")
    _login_as(client, db, "editor@test.com", role="editor", group_id=gid)
    eid = db.create_event(group_id=gid, type="gig", name="Show", date="2026-04-01")

    resp = client.delete(f"/api/events/{eid}")
    assert resp.status_code == 403
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_api.py::test_get_event tests/test_api.py::test_get_event_not_found tests/test_api.py::test_update_event tests/test_api.py::test_update_event_validation tests/test_api.py::test_delete_event tests/test_api.py::test_editor_cannot_delete_event -v`
Expected: FAIL

- [ ] **Step 3: Implement endpoints**

```python
@app.get("/api/events/{event_id}", response_model=EventResponse)
def get_event(event_id: int, request: Request):
    db = get_db()
    event = _get_event_with_access(db, event_id, request)
    return _event_response(event, request)


@app.put("/api/events/{event_id}", response_model=EventResponse)
def update_event(event_id: int, req: UpdateEventRequest, request: Request):
    db = get_db()
    event = _get_event_with_access(db, event_id, request)
    _require_role(request, "editor")
    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    if "name" in fields:
        fields["name"] = fields["name"].strip()
        if not fields["name"]:
            raise HTTPException(status_code=400, detail="Event name cannot be empty")
    _validate_event_fields(
        type=fields.get("type"),
        date=fields.get("date"),
        time=fields.get("time", event.time),
        end_time=fields.get("end_time", event.end_time),
        status=fields.get("status"),
    )
    user_id = request.state.user.id if request.state.user else None
    db.update_event(event_id, updated_by=user_id, **fields)
    if request.state.user:
        db.log_activity(request.state.user.id, event.group_id, "event_updated", event.name)
    event = db.get_event(event_id)
    return _event_response(event, request)


@app.delete("/api/events/{event_id}")
def delete_event(event_id: int, request: Request):
    db = get_db()
    event = _get_event_with_access(db, event_id, request)
    _require_role(request, "admin")
    if request.state.user:
        db.log_activity(request.state.user.id, event.group_id, "event_deleted", event.name)
    db.delete_event(event_id)
    return {"ok": True}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_api.py::test_get_event tests/test_api.py::test_get_event_not_found tests/test_api.py::test_update_event tests/test_api.py::test_update_event_validation tests/test_api.py::test_delete_event tests/test_api.py::test_editor_cannot_delete_event -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/jam_session_processor/api.py tests/test_api.py
git commit -m "feat(api): add event detail, update, and delete endpoints"
```

---

### Task 9: Add RSVP endpoints

**Files:**
- Modify: `src/jam_session_processor/api.py`
- Test: `tests/test_api.py`

- [ ] **Step 1: Write the failing tests**

```python
def test_event_rsvp(auth_client):
    client, uid, gid = auth_client
    resp = client.post("/api/events", json={"group_id": gid, "type": "rehearsal", "name": "Practice", "date": "2026-03-21"})
    eid = resp.json()["id"]

    # Set RSVP
    resp = client.post(f"/api/events/{eid}/respond", json={"status": "yes", "comment": "Bringing snacks"})
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    # Verify response shows up in event detail
    resp = client.get(f"/api/events/{eid}")
    data = resp.json()
    assert data["my_response"]["status"] == "yes"
    assert data["my_response"]["comment"] == "Bringing snacks"
    assert data["response_summary"]["yes"] == 1

    # Update RSVP
    resp = client.post(f"/api/events/{eid}/respond", json={"status": "no"})
    assert resp.status_code == 200
    resp = client.get(f"/api/events/{eid}")
    assert resp.json()["my_response"]["status"] == "no"

    # Clear RSVP
    resp = client.delete(f"/api/events/{eid}/respond")
    assert resp.status_code == 200
    resp = client.get(f"/api/events/{eid}")
    assert resp.json()["my_response"] is None


def test_rsvp_invalid_status(auth_client):
    client, uid, gid = auth_client
    resp = client.post("/api/events", json={"group_id": gid, "type": "gig", "name": "Show", "date": "2026-04-01"})
    eid = resp.json()["id"]

    resp = client.post(f"/api/events/{eid}/respond", json={"status": "absolutely"})
    assert resp.status_code == 422


def test_readonly_can_rsvp(client):
    db = api._db
    gid = db.create_group("Band")
    _login_as(client, db, "readonly@test.com", role="readonly", group_id=gid)
    eid = db.create_event(group_id=gid, type="rehearsal", name="Practice", date="2026-03-21")

    resp = client.post(f"/api/events/{eid}/respond", json={"status": "yes"})
    assert resp.status_code == 200


def test_readonly_cannot_create_event(client):
    db = api._db
    gid = db.create_group("Band")
    _login_as(client, db, "readonly@test.com", role="readonly", group_id=gid)

    resp = client.post("/api/events", json={"group_id": gid, "type": "gig", "name": "Show", "date": "2026-04-01"})
    assert resp.status_code == 403


def test_event_group_scoping(client):
    db = api._db
    uid1 = db.create_user("u1@test.com", hash_password("pw"), role="admin")
    gid_a = db.create_group("GroupA")
    db.assign_user_to_group(uid1, gid_a)
    uid2 = db.create_user("u2@test.com", hash_password("pw"), role="admin")
    gid_b = db.create_group("GroupB")
    db.assign_user_to_group(uid2, gid_b)

    db.create_event(group_id=gid_a, type="rehearsal", name="A Practice", date="2026-03-21")
    db.create_event(group_id=gid_b, type="gig", name="B Show", date="2026-03-22")

    client.post("/api/auth/login", json={"email": "u1@test.com", "password": "pw"})
    resp = client.get("/api/events?include_past=true")
    assert len(resp.json()) == 1
    assert resp.json()[0]["name"] == "A Practice"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_api.py::test_event_rsvp tests/test_api.py::test_rsvp_invalid_status tests/test_api.py::test_readonly_can_rsvp tests/test_api.py::test_readonly_cannot_create_event tests/test_api.py::test_event_group_scoping -v`
Expected: FAIL

- [ ] **Step 3: Implement RSVP endpoints**

```python
@app.post("/api/events/{event_id}/respond")
def respond_to_event(event_id: int, req: EventRSVPRequest, request: Request):
    db = get_db()
    event = _get_event_with_access(db, event_id, request)
    if req.status not in _VALID_RSVP_STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of: {', '.join(_VALID_RSVP_STATUSES)}")
    user_id = request.state.user.id
    db.set_event_response(event_id, user_id, req.status, req.comment)
    if request.state.user:
        db.log_activity(user_id, event.group_id, "event_response", f"{event.name}: {req.status}")
    return {"ok": True}


@app.delete("/api/events/{event_id}/respond")
def clear_event_response(event_id: int, request: Request):
    db = get_db()
    _get_event_with_access(db, event_id, request)
    user_id = request.state.user.id
    db.delete_event_response(event_id, user_id)
    return {"ok": True}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_api.py::test_event_rsvp tests/test_api.py::test_rsvp_invalid_status tests/test_api.py::test_readonly_can_rsvp tests/test_api.py::test_readonly_cannot_create_event tests/test_api.py::test_event_group_scoping -v`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pytest`
Expected: All tests pass

- [ ] **Step 6: Run linter**

Run: `ruff check src/ tests/`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/jam_session_processor/api.py tests/test_api.py
git commit -m "feat(api): add RSVP endpoints with readonly access"
```

---

## Chunk 3: Frontend

### Task 10: Add event types and API methods

**Files:**
- Modify: `web/src/api.ts`

- [ ] **Step 1: Add TypeScript interfaces**

Add after the `SetlistSong` interface:

```typescript
export interface Event {
  id: number;
  group_id: number;
  group_name: string;
  type: "rehearsal" | "gig";
  name: string;
  date: string;
  time: string | null;
  end_time: string | null;
  location: string | null;
  status: "tentative" | "confirmed" | "cancelled";
  notes: string;
  created_by_name: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string | null;
  response_summary: { yes: number; no: number; maybe: number; pending: number } | null;
  my_response: { status: string; comment: string | null } | null;
}

export interface EventMemberResponse {
  user_id: number;
  user_name: string;
  status: string;
  comment: string | null;
  responded_at: string | null;
}
```

- [ ] **Step 2: Add API methods**

Add to the `api` object:

```typescript
// Events
listEvents: (type?: string, includePast?: boolean) => {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (includePast) params.set("include_past", "true");
  const qs = params.toString();
  return fetchJson<Event[]>(`${BASE}/events${qs ? `?${qs}` : ""}`);
},

createEvent: (data: {
  group_id: number;
  type: string;
  name: string;
  date: string;
  time?: string;
  end_time?: string;
  location?: string;
  status?: string;
  notes?: string;
}) =>
  fetchJson<Event>(`${BASE}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }),

getEvent: (id: number) => fetchJson<Event>(`${BASE}/events/${id}`),

updateEvent: (id: number, fields: Record<string, unknown>) =>
  fetchJson<Event>(`${BASE}/events/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  }),

deleteEvent: (id: number) =>
  fetchJson<{ ok: boolean }>(`${BASE}/events/${id}`, { method: "DELETE" }),

respondToEvent: (id: number, status: string, comment?: string) =>
  fetchJson<{ ok: boolean }>(`${BASE}/events/${id}/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, comment: comment ?? null }),
  }),

clearEventResponse: (id: number) =>
  fetchJson<{ ok: boolean }>(`${BASE}/events/${id}/respond`, { method: "DELETE" }),

getEventResponses: (id: number) =>
  fetchJson<EventMemberResponse[]>(`${BASE}/events/${id}/responses`),
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add web/src/api.ts
git commit -m "feat(frontend): add Event types and API methods"
```

---

### Task 11: Add event detail endpoint for member responses

The event detail view needs a way to fetch all member responses. The current `GET /api/events/{id}` returns the event with `my_response` and `response_summary`, but not the full member list. We need to either extend it or add a sub-endpoint.

**Files:**
- Modify: `src/jam_session_processor/api.py`
- Test: `tests/test_api.py`

- [ ] **Step 1: Write the failing test**

```python
def test_get_event_responses(auth_client):
    client, uid, gid = auth_client
    resp = client.post("/api/events", json={"group_id": gid, "type": "rehearsal", "name": "Practice", "date": "2026-03-21"})
    eid = resp.json()["id"]

    client.post(f"/api/events/{eid}/respond", json={"status": "yes", "comment": "I'm in"})

    resp = client.get(f"/api/events/{eid}/responses")
    assert resp.status_code == 200
    data = resp.json()
    # Should include all group members (1 responded + any pending)
    assert len(data) >= 1
    responded = [r for r in data if r["status"] != "pending"]
    assert len(responded) == 1
    assert responded[0]["status"] == "yes"
    assert responded[0]["comment"] == "I'm in"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_api.py::test_get_event_responses -v`
Expected: FAIL

- [ ] **Step 3: Implement endpoint**

```python
@app.get("/api/events/{event_id}/responses", response_model=list[EventMemberResponse])
def get_event_responses(event_id: int, request: Request):
    db = get_db()
    event = _get_event_with_access(db, event_id, request)
    responses = db.get_event_responses(event_id)
    responded_ids = {r.user_id for r in responses}
    members = db.get_users_for_group(event.group_id)
    result = []
    for r in responses:
        result.append(EventMemberResponse(
            user_id=r.user_id, user_name=r.user_name,
            status=r.status, comment=r.comment, responded_at=r.responded_at,
        ))
    for m in members:
        if m.id not in responded_ids:
            result.append(EventMemberResponse(
                user_id=m.id, user_name=m.name or m.email,
                status="pending", comment=None, responded_at=None,
            ))
    return result
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_api.py::test_get_event_responses -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/jam_session_processor/api.py tests/test_api.py
git commit -m "feat(api): add event responses list endpoint"
```

---

### Task 12: Create ScheduleList page

**Files:**
- Create: `web/src/pages/ScheduleList.tsx`

- [ ] **Step 1: Create the ScheduleList page**

Create `web/src/pages/ScheduleList.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router";
import { api, formatDate, canEdit } from "../api";
import type { Event } from "../api";
import FormModal from "../components/FormModal";
import GroupSelector from "../components/GroupSelector";
import { ListSkeleton } from "../components/PageLoadingSkeleton";
import { Toast } from "../components/Modal";
import { useAuth } from "../context/AuthContext";

type TypeFilter = "all" | "rehearsal" | "gig";

const TYPE_BADGE: Record<string, string> = {
  rehearsal: "bg-gray-700 text-gray-300",
  gig: "bg-accent-900 text-accent-300",
};

const STATUS_BADGE: Record<string, string> = {
  tentative: "bg-yellow-900/50 text-yellow-400",
  confirmed: "bg-green-900/50 text-green-400",
  cancelled: "bg-red-900/50 text-red-400",
};

const RSVP_STYLES: Record<string, { active: string; inactive: string }> = {
  yes: {
    active: "bg-green-600 text-white",
    inactive: "border border-green-700 text-green-400 hover:bg-green-900/50",
  },
  maybe: {
    active: "bg-yellow-600 text-white",
    inactive: "border border-yellow-700 text-yellow-400 hover:bg-yellow-900/50",
  },
  no: {
    active: "bg-red-600 text-white",
    inactive: "border border-red-700 text-red-400 hover:bg-red-900/50",
  },
};

function RsvpButtons({
  myResponse,
  onRespond,
}: {
  myResponse: string | null;
  onRespond: (status: string) => void;
}) {
  return (
    <div className="flex gap-1">
      {(["yes", "maybe", "no"] as const).map((s) => (
        <button
          key={s}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRespond(s);
          }}
          className={`rounded px-2 py-0.5 text-xs font-medium transition ${
            myResponse === s ? RSVP_STYLES[s].active : RSVP_STYLES[s].inactive
          }`}
        >
          {s === "yes" ? "Yes" : s === "maybe" ? "Maybe" : "No"}
        </button>
      ))}
    </div>
  );
}

function ResponseSummary({ summary }: { summary: Event["response_summary"] }) {
  if (!summary) return null;
  const parts: string[] = [];
  if (summary.yes) parts.push(`${summary.yes} yes`);
  if (summary.no) parts.push(`${summary.no} no`);
  if (summary.maybe) parts.push(`${summary.maybe} maybe`);
  if (summary.pending) parts.push(`${summary.pending} pending`);
  return <span className="text-xs text-gray-500">{parts.join(", ")}</span>;
}

export default function ScheduleList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [showPast, setShowPast] = useState(false);
  const [groupFilter, setGroupFilter] = useState<number | null>(() => {
    const stored = localStorage.getItem("group-filter");
    if (stored) {
      const n = Number(stored);
      if (!isNaN(n)) return n;
    }
    return null;
  });
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<string>("rehearsal");
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [newGroupId, setNewGroupId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchEvents = () => {
    const typeParam = typeFilter === "all" ? undefined : typeFilter;
    api.listEvents(typeParam, showPast).then((data) => {
      setEvents(data);
      setLoading(false);
    });
  };

  useEffect(() => {
    setLoading(true);
    fetchEvents();
  }, [typeFilter, showPast]);

  const filtered = useMemo(() => {
    if (groupFilter === null) return events;
    return events.filter((e) => e.group_id === groupFilter);
  }, [events, groupFilter]);

  // Group events by month
  const grouped = useMemo(() => {
    const groups: Record<string, Event[]> = {};
    for (const e of filtered) {
      const month = e.date.slice(0, 7); // YYYY-MM
      if (!groups[month]) groups[month] = [];
      groups[month].push(e);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const defaultGroupId =
    user && user.groups.length === 1 ? user.groups[0].id : null;

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || !newDate) return;
    const groupId = newGroupId ?? defaultGroupId;
    if (!groupId) return;
    try {
      const event = await api.createEvent({
        group_id: groupId,
        type: newType,
        name,
        date: newDate,
        time: newTime || undefined,
        location: newLocation || undefined,
      });
      navigate(`/schedule/${event.id}`);
    } catch (err) {
      setErrorMsg(
        `Failed to create event: ${err instanceof Error ? err.message : err}`
      );
    }
  };

  const handleRsvp = async (eventId: number, status: string) => {
    const event = events.find((e) => e.id === eventId);
    if (event?.my_response?.status === status) {
      await api.clearEventResponse(eventId);
    } else {
      await api.respondToEvent(eventId, status);
    }
    fetchEvents();
  };

  const formatMonth = (ym: string) => {
    const [y, m] = ym.split("-");
    const d = new Date(Number(y), Number(m) - 1);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "long" });
  };

  if (loading)
    return (
      <ListSkeleton
        title="Schedule"
        count={4}
        lineWidths={["w-40", "w-32", "w-48", "w-36"]}
      />
    );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <GroupSelector
          value={groupFilter}
          onChange={setGroupFilter}
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-gray-300"
        >
          <option value="all">All types</option>
          <option value="rehearsal">Rehearsals</option>
          <option value="gig">Gigs</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-400">
          <input
            type="checkbox"
            checked={showPast}
            onChange={(e) => setShowPast(e.target.checked)}
            className="rounded border-gray-600 bg-gray-800"
          />
          Show past
        </label>
        <div className="flex-1" />
        {canEdit(user) && (
          <button
            onClick={() => {
              setCreating(true);
              setNewName("");
              setNewDate("");
              setNewTime("");
              setNewLocation("");
              setNewType("rehearsal");
              setNewGroupId(defaultGroupId);
              setErrorMsg(null);
            }}
            className="rounded bg-accent-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent-500"
          >
            New Event
          </button>
        )}
      </div>

      <FormModal
        open={creating && canEdit(user) === true}
        title="New Event"
        error={errorMsg}
        confirmLabel="Create"
        onConfirm={handleCreate}
        onCancel={() => setCreating(false)}
      >
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Event name"
          className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500"
          autoFocus
        />
        <select
          value={newType}
          onChange={(e) => setNewType(e.target.value)}
          className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-300"
        >
          <option value="rehearsal">Rehearsal</option>
          <option value="gig">Gig</option>
        </select>
        <input
          type="date"
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
          className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
        />
        <input
          type="time"
          value={newTime}
          onChange={(e) => setNewTime(e.target.value)}
          className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
        />
        <input
          type="text"
          value={newLocation}
          onChange={(e) => setNewLocation(e.target.value)}
          placeholder="Location (optional)"
          className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500"
        />
        {user && user.groups.length > 1 && (
          <select
            value={newGroupId ?? ""}
            onChange={(e) => setNewGroupId(Number(e.target.value))}
            className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-300"
          >
            <option value="">Select group...</option>
            {user.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        )}
      </FormModal>

      {filtered.length === 0 && !creating ? (
        <p className="py-12 text-center text-gray-500">
          No upcoming events. Create one to get started.
        </p>
      ) : (
        <div className="space-y-6">
          {grouped.map(([month, monthEvents]) => (
            <div key={month}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                {formatMonth(month)}
              </h3>
              <div className="space-y-2">
                {monthEvents.map((event) => (
                  <Link
                    key={event.id}
                    to={`/schedule/${event.id}`}
                    className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 transition hover:border-accent-500 hover:bg-gray-800"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${TYPE_BADGE[event.type]}`}
                        >
                          {event.type}
                        </span>
                        <span className="truncate font-medium text-white">
                          {event.name}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[event.status]}`}
                        >
                          {event.status}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-sm text-gray-400">
                        <span>{formatDate(event.date)}</span>
                        {event.time && <span>{event.time}</span>}
                        {event.location && (
                          <span className="truncate">{event.location}</span>
                        )}
                      </div>
                      <div className="mt-1">
                        <ResponseSummary summary={event.response_summary} />
                      </div>
                    </div>
                    <div className="ml-3 shrink-0">
                      <RsvpButtons
                        myResponse={event.my_response?.status ?? null}
                        onRespond={(s) => handleRsvp(event.id, s)}
                      />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/ScheduleList.tsx
git commit -m "feat(frontend): add ScheduleList page"
```

---

### Task 13: Create ScheduleDetail page

**Files:**
- Create: `web/src/pages/ScheduleDetail.tsx`

- [ ] **Step 1: Create the ScheduleDetail page**

Create `web/src/pages/ScheduleDetail.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { api, formatDate, formatDateTime, canEdit, canAdmin } from "../api";
import type { Event, EventMemberResponse } from "../api";
import EditableField from "../components/EditableField";
import Modal, { Toast } from "../components/Modal";
import { useAuth } from "../context/AuthContext";
import { DetailSkeleton } from "../components/PageLoadingSkeleton";

const STATUS_BADGE: Record<string, string> = {
  tentative: "bg-yellow-900/50 text-yellow-400",
  confirmed: "bg-green-900/50 text-green-400",
  cancelled: "bg-red-900/50 text-red-400",
};

const RSVP_COLORS: Record<string, string> = {
  yes: "text-green-400",
  no: "text-red-400",
  maybe: "text-yellow-400",
  pending: "text-gray-500",
};

const RSVP_BUTTON_STYLES: Record<string, { active: string; inactive: string }> = {
  yes: {
    active: "bg-green-600 text-white",
    inactive: "border border-green-700 text-green-400 hover:bg-green-900/50",
  },
  maybe: {
    active: "bg-yellow-600 text-white",
    inactive: "border border-yellow-700 text-yellow-400 hover:bg-yellow-900/50",
  },
  no: {
    active: "bg-red-600 text-white",
    inactive: "border border-red-700 text-red-400 hover:bg-red-900/50",
  },
};

// Sort order for responses: yes, maybe, pending, no
const SORT_ORDER: Record<string, number> = { yes: 0, maybe: 1, pending: 2, no: 3 };

export default function ScheduleDetail() {
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const eventId = Number(id);
  const [event, setEvent] = useState<Event | null>(null);
  const [responses, setResponses] = useState<EventMemberResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [comment, setComment] = useState("");

  // Editable fields
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [editingDate, setEditingDate] = useState(false);
  const [dateInput, setDateInput] = useState("");
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesInput, setNotesInput] = useState("");

  const fetchData = async () => {
    try {
      const [ev, resps] = await Promise.all([
        api.getEvent(eventId),
        api.getEventResponses(eventId),
      ]);
      setEvent(ev);
      setNameInput(ev.name);
      setDateInput(ev.date);
      setNotesInput(ev.notes);
      setResponses(resps.sort((a, b) => (SORT_ORDER[a.status] ?? 9) - (SORT_ORDER[b.status] ?? 9)));
      // Set comment from current user's response
      const myResp = resps.find((r) => r.user_id === user?.id);
      setComment(myResp?.comment ?? "");
      setLoading(false);
    } catch {
      setErrorMsg("Failed to load event");
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [eventId]);

  const handleRsvp = async (status: string) => {
    if (event?.my_response?.status === status) {
      await api.clearEventResponse(eventId);
    } else {
      await api.respondToEvent(eventId, status, comment || undefined);
    }
    await fetchData();
  };

  const handleUpdateComment = async () => {
    if (!event?.my_response) return;
    await api.respondToEvent(eventId, event.my_response.status, comment || undefined);
    await fetchData();
  };

  const handleSaveName = async () => {
    const name = nameInput.trim();
    if (!name || name === event?.name) {
      setEditingName(false);
      return;
    }
    try {
      const updated = await api.updateEvent(eventId, { name });
      setEvent(updated);
      setEditingName(false);
    } catch (err) {
      setErrorMsg(`Failed to rename: ${err}`);
    }
  };

  const handleSaveDate = async () => {
    if (dateInput === event?.date) {
      setEditingDate(false);
      return;
    }
    try {
      const updated = await api.updateEvent(eventId, { date: dateInput });
      setEvent(updated);
      setEditingDate(false);
    } catch (err) {
      setErrorMsg(`Failed to update date: ${err}`);
    }
  };

  const handleSaveNotes = async () => {
    if (notesInput === event?.notes) {
      setEditingNotes(false);
      return;
    }
    try {
      const updated = await api.updateEvent(eventId, { notes: notesInput });
      setEvent(updated);
      setEditingNotes(false);
    } catch (err) {
      setErrorMsg(`Failed to update notes: ${err}`);
    }
  };

  const handleUpdateField = async (field: string, value: string) => {
    try {
      const updated = await api.updateEvent(eventId, { [field]: value });
      setEvent(updated);
    } catch (err) {
      setErrorMsg(`Failed to update: ${err}`);
    }
  };

  const handleDelete = async () => {
    try {
      await api.deleteEvent(eventId);
      navigate("/schedule");
    } catch (err) {
      setErrorMsg(`Failed to delete: ${err}`);
    }
  };

  if (loading) return <DetailSkeleton />;
  if (!event) return <p className="py-12 text-center text-gray-500">Event not found</p>;

  return (
    <div>
      {errorMsg && <Toast message={errorMsg} onClose={() => setErrorMsg(null)} />}

      <div className="mb-4 flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                event.type === "gig" ? "bg-accent-900 text-accent-300" : "bg-gray-700 text-gray-300"
              }`}
            >
              {event.type}
            </span>
            {canEdit(user) && (
              <select
                value={event.status}
                onChange={(e) => handleUpdateField("status", e.target.value)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[event.status]} border-0 bg-transparent`}
              >
                <option value="tentative">tentative</option>
                <option value="confirmed">confirmed</option>
                <option value="cancelled">cancelled</option>
              </select>
            )}
            {!canEdit(user) && (
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[event.status]}`}>
                {event.status}
              </span>
            )}
          </div>
          <EditableField
            value={nameInput}
            editing={editingName}
            onChange={setNameInput}
            onSave={handleSaveName}
            onCancel={() => { setNameInput(event.name); setEditingName(false); }}
            onEdit={() => setEditingName(true)}
            readonly={!canEdit(user)}
            variant="h1"
          />
          <EditableField
            value={dateInput}
            editing={editingDate}
            onChange={setDateInput}
            onSave={handleSaveDate}
            onCancel={() => { setDateInput(event.date); setEditingDate(false); }}
            onEdit={() => setEditingDate(true)}
            readonly={!canEdit(user)}
            type="date"
          />
          {event.time && (
            <p className="text-sm text-gray-400">
              {event.time}{event.end_time ? ` – ${event.end_time}` : ""}
            </p>
          )}
          {event.location && (
            <p className="text-sm text-gray-400">{event.location}</p>
          )}
        </div>
        {canAdmin(user) && (
          <button
            onClick={() => setShowDelete(true)}
            className="shrink-0 rounded px-3 py-1.5 text-sm text-red-400 transition hover:bg-red-900/30"
          >
            Delete
          </button>
        )}
      </div>

      {/* Notes */}
      {(event.notes || canEdit(user)) && (
        <div className="mb-6">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">Notes</h2>
          {editingNotes ? (
            <div>
              <textarea
                value={notesInput}
                onChange={(e) => setNotesInput(e.target.value)}
                className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
                rows={3}
              />
              <div className="mt-1 flex gap-2">
                <button onClick={handleSaveNotes} className="rounded bg-accent-600 px-3 py-1 text-xs text-white">Save</button>
                <button onClick={() => { setNotesInput(event.notes); setEditingNotes(false); }} className="rounded px-3 py-1 text-xs text-gray-400">Cancel</button>
              </div>
            </div>
          ) : (
            <p
              className={`text-sm ${event.notes ? "text-gray-300" : "text-gray-600"} ${canEdit(user) ? "cursor-pointer hover:text-gray-200" : ""}`}
              onClick={() => canEdit(user) && setEditingNotes(true)}
            >
              {event.notes || "Add notes..."}
            </p>
          )}
        </div>
      )}

      {/* RSVP */}
      <div className="mb-6 rounded-lg border border-gray-800 bg-gray-900 p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Your Response</h2>
        <div className="flex items-center gap-2">
          {(["yes", "maybe", "no"] as const).map((s) => (
            <button
              key={s}
              onClick={() => handleRsvp(s)}
              className={`rounded px-4 py-1.5 text-sm font-medium transition ${
                event.my_response?.status === s
                  ? RSVP_BUTTON_STYLES[s].active
                  : RSVP_BUTTON_STYLES[s].inactive
              }`}
            >
              {s === "yes" ? "Yes" : s === "maybe" ? "Maybe" : "No"}
            </button>
          ))}
        </div>
        {event.my_response && (
          <div className="mt-3">
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onBlur={handleUpdateComment}
              placeholder="Add a comment..."
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500"
            />
          </div>
        )}
      </div>

      {/* Member Responses */}
      <div className="mb-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Responses ({responses.filter((r) => r.status !== "pending").length}/{responses.length})
        </h2>
        <div className="space-y-1">
          {responses.map((r) => (
            <div
              key={r.user_id}
              className="flex items-center justify-between rounded-lg px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="text-white">{r.user_name}</span>
                {r.comment && (
                  <span className="text-gray-500">– {r.comment}</span>
                )}
              </div>
              <span className={`text-xs font-medium ${RSVP_COLORS[r.status]}`}>
                {r.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Metadata */}
      {(event.created_by_name || event.updated_by_name) && (
        <div className="text-xs text-gray-600">
          {event.created_by_name && <p>Created by {event.created_by_name}</p>}
          {event.updated_by_name && event.updated_at && (
            <p>Updated by {event.updated_by_name} on {formatDateTime(event.updated_at)}</p>
          )}
        </div>
      )}

      <Modal open={showDelete} onClose={() => setShowDelete(false)}>
        <p className="text-sm text-gray-300">
          Delete "{event.name}"? This cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => setShowDelete(false)}
            className="rounded px-4 py-2 text-sm text-gray-400 hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
          >
            Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/ScheduleDetail.tsx
git commit -m "feat(frontend): add ScheduleDetail page"
```

---

### Task 14: Add Schedule to navigation and routes

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Add import at top of App.tsx**

Add with the other lazy imports or page imports:

```tsx
import ScheduleList from "./pages/ScheduleList";
import ScheduleDetail from "./pages/ScheduleDetail";
```

- [ ] **Step 2: Add routes**

Add after the setlist routes:

```tsx
<Route path="/schedule" element={<ScheduleList />} />
<Route path="/schedule/:id" element={<ScheduleDetail />} />
```

- [ ] **Step 3: Add desktop nav link**

After the Setlists NavLink (line ~206) and before the Tools `<div>` (line ~207), add:

```tsx
<NavLink
  to="/schedule"
  className={({ isActive }) =>
    `py-2 px-3 ${isActive ? "text-accent-400" : "text-gray-400 hover:text-gray-200"}`
  }
>
  Schedule
</NavLink>
```

- [ ] **Step 4: Add mobile bottom nav tab**

After the Setlists NavLink (line ~310) and before the Tools `<div>` (line ~311), add:

```tsx
<NavLink to="/schedule" className={({ isActive }) =>
  `flex flex-1 flex-col items-center gap-0.5 py-2 ${isActive ? "text-accent-400" : "text-gray-500"}`
}>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
    <path fillRule="evenodd" d="M5.75 2a.75.75 0 01.75.75V4h7V2.75a.75.75 0 011.5 0V4h.25A2.75 2.75 0 0118 6.75v8.5A2.75 2.75 0 0115.25 18H4.75A2.75 2.75 0 012 15.25v-8.5A2.75 2.75 0 014.75 4H5V2.75A.75.75 0 015.75 2zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75z" clipRule="evenodd" />
  </svg>
  <span className="text-[10px] font-medium">Schedule</span>
</NavLink>
```

- [ ] **Step 5: Verify TypeScript compiles and build succeeds**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat(frontend): add Schedule to navigation and routes"
```

---

## Chunk 4: Seed Data & Final Verification

### Task 15: Add sample events to seed script

**Files:**
- Modify: `scripts/seed-db.py`

- [ ] **Step 1: Add event seed data**

Add after the setlist seeding section (after the setlist `print` line):

```python
# ── Events ────────────────────────────────────────────────────────
event_data = [
    (
        "Porch Dogs",
        "rehearsal",
        "Tuesday Practice",
        "2026-03-17",
        "19:00",
        "21:00",
        "Dave's garage",
        "confirmed",
        "Bring charts for new songs",
        [("yes", "I'll bring snacks"), ("yes", None), ("maybe", "Might be 15 min late")],
    ),
    (
        "Porch Dogs",
        "gig",
        "The Tipsy Crow",
        "2026-03-28",
        "20:00",
        "23:00",
        "The Tipsy Crow, 1535 Broadway",
        "tentative",
        "Waiting on confirmation from venue. $200 + tips.",
        [("yes", None), ("maybe", "Need to check work schedule"), ("no", "Out of town")],
    ),
    (
        "Porch Dogs",
        "rehearsal",
        "Pre-show Rehearsal",
        "2026-03-27",
        "18:00",
        "20:00",
        "Dave's garage",
        "tentative",
        "Run through the setlist for Saturday",
        [("yes", None), ("yes", None)],
    ),
    (
        "The Slow Burners",
        "rehearsal",
        "Weekly Jam",
        "2026-03-19",
        "20:00",
        None,
        "Mike's basement",
        "confirmed",
        "",
        [("yes", None), ("yes", "Bringing the new amp")],
    ),
    (
        "The Slow Burners",
        "gig",
        "Open Mic Night",
        "2026-04-10",
        "19:30",
        "22:00",
        "The Hollow",
        "confirmed",
        "Acoustic set, 3 songs max",
        [("yes", None)],
    ),
]
for ev_idx, (group_name, etype, ename, edate, etime, eend, eloc, estatus, enotes, rsvps) in enumerate(event_data):
    gid = group_ids[group_name]
    creator = pick_user(group_name, ev_idx)
    eid = db.create_event(
        group_id=gid, type=etype, name=ename, date=edate,
        time=etime, end_time=eend, location=eloc,
        status=estatus, notes=enotes, created_by=creator,
    )
    # Add RSVP responses from group members
    members = db.get_users_for_group(gid)
    for i, (rstatus, rcomment) in enumerate(rsvps):
        if i < len(members):
            db.set_event_response(eid, members[i].id, rstatus, rcomment)
print(f"  Events: {len(event_data)}")
```

- [ ] **Step 2: Verify seed script runs**

Run: `python scripts/seed-db.py`
Expected: Output includes `Events: 5`

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-db.py
git commit -m "feat(seed): add sample events and RSVP responses"
```

---

### Task 16: Run full test suite and lint

- [ ] **Step 1: Run all tests**

Run: `pytest`
Expected: All tests pass

- [ ] **Step 2: Run linter**

Run: `ruff check src/ tests/`
Expected: No errors

- [ ] **Step 3: Run frontend type check**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Verify the app starts and schedule page loads**

Run the dev server and verify:
1. `jam-session serve` starts without errors
2. `cd web && npm run dev` starts the frontend
3. Navigate to `/schedule` — page loads, shows seeded events
4. Click an event — detail page loads with responses
5. RSVP buttons work
6. Create modal works for editor+ users

---

### Task 17: Update CLAUDE.md documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add events/event_responses to the Database Schema section**

Add after the `setlist_songs` table:

```
events                          event_responses
──────────────                 ─────────────────
id (PK)                        id (PK)
group_id (FK→groups)           event_id (FK→events)
type                           user_id (FK→users)
name                           status
date                           comment
time, end_time                 responded_at
location                       UNIQUE(event_id, user_id)
status
notes
created_by (FK→users)
updated_by (FK→users)
updated_at
created_at
```

- [ ] **Step 2: Add event endpoints to the REST API section**

Add after the Setlists section:

```
**Events:** `GET /api/events` | `POST /api/events` (editor) | `GET /api/events/{id}` | `PUT /api/events/{id}` (editor) | `DELETE /api/events/{id}` (admin) | `POST /api/events/{id}/respond` | `DELETE /api/events/{id}/respond` | `GET /api/events/{id}/responses`
```

- [ ] **Step 3: Add relationships**

Add to the relationship notes:
```
- `groups → events`: one-to-many, CASCADE delete
- `events → event_responses`: one-to-many, CASCADE delete
- `event_responses → users`: many-to-one, CASCADE delete
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add event scheduling to CLAUDE.md schema and API reference"
```
