# Track Trimming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to trim track start/end points by pausing playback and clicking "Trim start here" or "Trim end here", with the backend re-exporting the audio segment.

**Architecture:** New `trim_track()` function in `track_ops.py` (alongside existing `merge_tracks`/`split_track`), new `PUT /api/tracks/{id}/trim` endpoint in `api.py`, new `trimTrack` API method and UI controls in `TrackRow.tsx`. The trim re-exports from the original session source file using `export_segment()`, replaces the audio file, and updates DB boundaries.

**Tech Stack:** Python/FastAPI, FFmpeg (via existing `export_segment`), React/TypeScript

---

### Task 1: Backend — `trim_track()` in `track_ops.py`

**Files:**
- Modify: `src/jam_session_processor/track_ops.py`
- Test: `tests/test_track_ops.py`

- [ ] **Step 1: Write failing test for basic trim-from-start**

Add to `tests/test_track_ops.py`:

```python
from jam_session_processor.track_ops import merge_tracks, split_track, trim_track

@patch("jam_session_processor.track_ops.export_segment", side_effect=_mock_export)
def test_trim_start(mock_export, db, session_with_tracks):
    sid, tids, output_dir = session_with_tracks
    # Track 1: 0-300s. Trim 10s from start.
    result = trim_track(db, tids[0], start_delta=10.0)

    assert result.start_sec == 10.0
    assert result.end_sec == 300.0
    assert result.duration_sec == 290.0
    assert result.track_number == 1
    mock_export.assert_called_once()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_track_ops.py::test_trim_start -v`
Expected: FAIL — `ImportError: cannot import name 'trim_track'`

- [ ] **Step 3: Write failing test for trim-from-end**

```python
@patch("jam_session_processor.track_ops.export_segment", side_effect=_mock_export)
def test_trim_end(mock_export, db, session_with_tracks):
    sid, tids, output_dir = session_with_tracks
    # Track 1: 0-300s. Remove 20s from end.
    result = trim_track(db, tids[0], end_delta=-20.0)

    assert result.start_sec == 0.0
    assert result.end_sec == 280.0
    assert result.duration_sec == 280.0
```

- [ ] **Step 4: Write failing test for trim preserves metadata**

```python
@patch("jam_session_processor.track_ops.export_segment", side_effect=_mock_export)
def test_trim_preserves_metadata(mock_export, db, group_id, session_with_tracks):
    sid, tids, output_dir = session_with_tracks
    db.tag_track(tids[0], "Fat Cat", group_id)
    db.update_track_notes(tids[0], "Great take")

    result = trim_track(db, tids[0], start_delta=10.0)

    assert result.song_name == "Fat Cat"
    assert result.notes == "Great take"
```

- [ ] **Step 5: Write failing test for extend (negative start_delta)**

```python
@patch("jam_session_processor.track_ops.export_segment", side_effect=_mock_export)
def test_trim_extend_start(mock_export, db, session_with_tracks):
    sid, tids, output_dir = session_with_tracks
    # Track 2: 300-600s. Extend start by 5s.
    result = trim_track(db, tids[1], start_delta=-5.0)

    assert result.start_sec == 295.0
    assert result.end_sec == 600.0
    assert result.duration_sec == 305.0
```

- [ ] **Step 6: Write failing tests for validation**

```python
def test_trim_no_deltas_fails(db, session_with_tracks):
    sid, tids, output_dir = session_with_tracks
    with pytest.raises(ValueError, match="at least one"):
        trim_track(db, tids[0])


def test_trim_result_too_short_fails(db, session_with_tracks):
    sid, tids, output_dir = session_with_tracks
    # Track is 300s, trimming 299.5s from start leaves 0.5s
    with pytest.raises(ValueError, match="at least 1 second"):
        trim_track(db, tids[0], start_delta=299.5)


def test_trim_nonexistent_track_fails(db):
    with pytest.raises(ValueError, match="not found"):
        trim_track(db, 9999, start_delta=10.0)


def test_trim_start_before_zero_fails(db, session_with_tracks):
    """Extending start past 0 should fail."""
    sid, tids, output_dir = session_with_tracks
    # Track 1 starts at 0. Extending by -10s should fail.
    with pytest.raises(ValueError, match="before start of recording"):
        trim_track(db, tids[0], start_delta=-10.0)


@patch("jam_session_processor.track_ops.export_segment", side_effect=_mock_export)
def test_trim_end_past_session_fails(mock_export, db, session_with_tracks):
    """Extending end past the session duration should fail."""
    sid, tids, output_dir = session_with_tracks
    # Set session duration so validation can check it
    db.update_session_duration(sid, 900.0)
    # Track 3 ends at 900. Extending by +10 should fail.
    with pytest.raises(ValueError, match="past end of recording"):
        trim_track(db, tids[2], end_delta=10.0)
```

- [ ] **Step 7: Implement `trim_track()` in `track_ops.py`**

Add to `src/jam_session_processor/track_ops.py`:

```python
def trim_track(
    db: Database,
    track_id: int,
    start_delta: float = 0.0,
    end_delta: float = 0.0,
    audio_format: AudioFormat = DEFAULT_FORMAT,
) -> Track:
    """Trim a track by adjusting start/end boundaries and re-exporting.

    start_delta positive = remove from beginning, negative = extend earlier.
    end_delta positive = extend later, negative = remove from end.
    Returns the updated Track.
    """
    if start_delta == 0.0 and end_delta == 0.0:
        raise ValueError("Must provide at least one of start_delta or end_delta")

    track = db.get_track(track_id)
    if not track:
        raise ValueError("Track not found")

    new_start = track.start_sec + start_delta
    new_end = track.end_sec + end_delta

    if new_start < 0:
        raise ValueError("Cannot extend before start of recording")

    session = db.get_session(track.session_id)
    if session.duration_sec and new_end > session.duration_sec:
        raise ValueError("Cannot extend past end of recording")

    new_duration = new_end - new_start
    if new_duration < 1.0:
        raise ValueError("Trimmed track must be at least 1 second long")

    cfg = get_config()
    storage = get_storage()
    source_file = cfg.resolve_path(session.source_file)
    output_dir = cfg.resolve_path(track.audio_path).parent

    # Ensure source file is local if using remote storage
    if storage.is_remote:
        source_file = storage.get(session.source_file, source_file)

    # Re-export trimmed segment
    total_tracks = len(db.get_tracks_for_session(session.id))
    filename = generate_output_name(
        track.track_number,
        max(total_tracks, 1),
        new_start,
        new_end,
        extension=audio_format.extension,
    )
    new_path = output_dir / filename
    export_segment(source_file, new_path, new_start, new_end, audio_format=audio_format)

    # Remove old audio file
    old_audio_path = track.audio_path
    new_rel_path = cfg.make_relative(new_path)

    # Only delete old file if path actually changed
    if old_audio_path != new_rel_path:
        storage.delete(old_audio_path)

    # Upload new file to remote storage
    if storage.is_remote:
        storage.put(new_rel_path, new_path)

    # Update DB
    db.update_track(
        track_id,
        start_sec=new_start,
        end_sec=new_end,
        duration_sec=new_duration,
        audio_path=new_rel_path,
    )

    return db.get_track(track_id)
```

- [ ] **Step 8: Run all trim tests**

Run: `pytest tests/test_track_ops.py -k trim -v`
Expected: All PASS

- [ ] **Step 9: Run full test suite**

Run: `pytest`
Expected: All PASS

- [ ] **Step 10: Commit**

```bash
git add src/jam_session_processor/track_ops.py tests/test_track_ops.py
git commit -m "feat: add trim_track() for adjusting track boundaries"
```

---

### Task 2: API endpoint — `PUT /api/tracks/{id}/trim`

**Files:**
- Modify: `src/jam_session_processor/api.py`
- Test: `tests/test_api.py`

- [ ] **Step 1: Write failing API test**

Find the existing split/merge API tests in `tests/test_api.py` (near `test_split_track_endpoint`) and add a trim test nearby. Use the `seeded_client_with_source` fixture which already patches `export_segment` and creates a session with 3 tracks (0-300, 300-600, 600-900).

```python
def test_trim_track_endpoint(seeded_client_with_source):
    resp = seeded_client_with_source.put("/api/tracks/1/trim", json={"start_delta": 5.0})
    assert resp.status_code == 200
    data = resp.json()
    assert data["start_sec"] == 5.0
    assert data["end_sec"] == 300.0


def test_trim_invalid_returns_400(seeded_client_with_source):
    resp = seeded_client_with_source.put("/api/tracks/1/trim", json={"start_delta": 299.5})
    assert resp.status_code == 400
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_api.py::test_trim_track_endpoint -v`
Expected: FAIL — 404 or 405

- [ ] **Step 3: Add TrimRequest model and endpoint to `api.py`**

Add after `SplitRequest`:

```python
class TrimRequest(BaseModel):
    start_delta: float = 0.0
    end_delta: float = 0.0
```

Add after the split endpoint:

```python
@app.put("/api/tracks/{track_id}/trim", response_model=TrackResponse)
def trim_track_endpoint(track_id: int, req: TrimRequest, request: Request):
    from jam_session_processor.track_ops import trim_track

    db = get_db()
    _get_track_with_access(db, track_id, request)
    _require_role(request, "admin")
    try:
        track = trim_track(db, track_id, start_delta=req.start_delta, end_delta=req.end_delta)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("Trim failed")
        raise HTTPException(status_code=500, detail="Trim failed")
    return _track_response(track)
```

- [ ] **Step 4: Run API test**

Run: `pytest tests/test_api.py::test_trim_track_endpoint tests/test_api.py::test_trim_invalid_returns_400 -v`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pytest`
Expected: All PASS

- [ ] **Step 6: Lint**

Run: `ruff check src/ tests/`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/jam_session_processor/api.py tests/test_api.py
git commit -m "feat: add PUT /api/tracks/{id}/trim endpoint"
```

---

### Task 3: Frontend — API client method

**Files:**
- Modify: `web/src/api.ts`

- [ ] **Step 1: Add `trimTrack` to API client**

Add after the `splitTrack` method in `web/src/api.ts`:

```typescript
trimTrack: (trackId: number, startDelta?: number, endDelta?: number) =>
  fetchJson<Track>(`${BASE}/tracks/${trackId}/trim`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      start_delta: startDelta ?? 0,
      end_delta: endDelta ?? 0,
    }),
  }),
```

Note: `trimTrack` returns a single `Track` (not `Track[]` like split/merge) since the track count doesn't change.

- [ ] **Step 2: TypeScript check**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add web/src/api.ts
git commit -m "feat: add trimTrack API client method"
```

---

### Task 4: Frontend — Trim UI in TrackRow

**Files:**
- Modify: `web/src/components/TrackRow.tsx`

- [ ] **Step 1: Add trim handler and state**

In `TrackRow.tsx`, add a `confirmingTrim` state and handler. Add these alongside the existing `confirmingSplit` / `handleSplit` pattern:

```typescript
const [confirmingTrim, setConfirmingTrim] = useState<"start" | "end" | null>(null);

const handleTrim = async () => {
  const trimType = confirmingTrim;
  setConfirmingTrim(null);
  setOperationLoading(true);
  try {
    if (trimType === "start") {
      await api.trimTrack(track.id, playerTime);
    } else {
      await api.trimTrack(track.id, undefined, -(track.duration_sec - playerTime));
    }
    onUpdate();
  } catch (err) {
    onError(`Trim failed: ${err instanceof Error ? err.message : err}`);
  } finally {
    setOperationLoading(false);
  }
};
```

- [ ] **Step 2: Add trim buttons to JSX**

Replace the existing split button section (`{/* Split button — shown when paused mid-take */}`) with a combined section that shows both trim and split buttons:

```tsx
{/* Track edit buttons — shown when paused mid-take */}
{!playerPlaying && playerTime > 0 && canAdmin(user) && (
  <div className="mt-2 flex flex-wrap gap-2">
    {playerTime > 1 && (
      <button
        onClick={() => setConfirmingTrim("start")}
        disabled={operationLoading}
        className="flex items-center gap-1.5 rounded bg-gray-800 px-3 py-2 text-xs text-gray-400 transition hover:bg-gray-700 hover:text-white disabled:opacity-50"
      >
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" d="M9 3v18M15 3l-6 6M15 21l-6-6" />
        </svg>
        Trim start to {formatTime(playerTime)}
      </button>
    )}
    {playerTime < track.duration_sec - 1 && playerTime > 0 && (
      <button
        onClick={() => setConfirmingTrim("end")}
        disabled={operationLoading}
        className="flex items-center gap-1.5 rounded bg-gray-800 px-3 py-2 text-xs text-gray-400 transition hover:bg-gray-700 hover:text-white disabled:opacity-50"
      >
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" d="M9 3v18M15 3l-6 6M15 21l-6-6" />
        </svg>
        Trim end to {formatTime(playerTime)}
      </button>
    )}
    {canSplit && (
      <button
        onClick={() => setConfirmingSplit(true)}
        disabled={operationLoading}
        className="flex items-center gap-1.5 rounded bg-gray-800 px-3 py-2 text-xs text-gray-400 transition hover:bg-gray-700 hover:text-white disabled:opacity-50"
      >
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" d="M12 4v16M4 12h16" />
        </svg>
        Split here ({formatTime(playerTime)})
      </button>
    )}
  </div>
)}
```

- [ ] **Step 3: Add trim confirmation modal**

Add after the existing split Modal:

```tsx
<Modal
  open={confirmingTrim !== null}
  title={confirmingTrim === "start" ? "Trim start" : "Trim end"}
  message={
    confirmingTrim === "start"
      ? `Remove the first ${formatTime(playerTime)} from this track?`
      : `Remove the last ${formatTime(track.duration_sec - playerTime)} from this track?`
  }
  confirmLabel="Trim"
  onConfirm={handleTrim}
  onCancel={() => setConfirmingTrim(null)}
/>
```

- [ ] **Step 4: TypeScript check**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add web/src/components/TrackRow.tsx
git commit -m "feat: add trim start/end UI buttons to track player"
```

---

### Task 5: Update docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add trim endpoint to REST API section**

In `CLAUDE.md`, add to the Tracks line in the REST API section:

`PUT /api/tracks/{id}/trim` (admin) — between the existing entries.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add trim endpoint to CLAUDE.md"
```
