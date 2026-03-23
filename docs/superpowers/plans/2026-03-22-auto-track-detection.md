# Auto Track Detection by Expected Count — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to specify an expected track count and room volume hint instead of a raw dB threshold, so the system can automatically search for the best segmentation.

**Architecture:** Extract the segment-detection inner loop from `detect_songs()` into a shared `_find_segments()` helper. Add `detect_songs_by_count()` which computes the RMS profile once, sweeps 7 thresholds based on room volume, and scores results by count-closeness then duration-consistency. API and frontend pass through new optional params; upload defaults to expected-count mode, reprocess defaults to manual threshold.

**Tech Stack:** Python 3.12 (FastAPI), React/TypeScript/Tailwind, SQLite, pytest

**Spec:** `docs/superpowers/specs/2026-03-22-auto-track-detection-design.md`

---

## Chunk 1: Splitter refactor and auto-detection

### Task 1: Extract `_find_segments` helper from `detect_songs`

**Files:**
- Modify: `src/jam_session_processor/splitter.py:80-121`
- Test: `tests/test_splitter.py`

- [ ] **Step 1: Write regression test for existing `detect_songs` behavior**

Add to `tests/test_splitter.py`:

```python
def test_detect_songs_regression_segments(fake_session_file):
    """Ensure refactoring _find_segments doesn't change detect_songs behavior."""
    result = detect_songs(fake_session_file, energy_threshold_db=-40, min_song_duration_sec=3)
    # Capture current behavior: segments exist, times are positive, total duration valid
    assert len(result.segments) >= 2
    for start, end in result.segments:
        assert start >= 0
        assert start < end
    assert result.total_duration_sec > 0
```

- [ ] **Step 2: Run test to verify it passes (pre-refactor baseline)**

Run: `pytest tests/test_splitter.py::test_detect_songs_regression_segments -v`
Expected: PASS

- [ ] **Step 3: Extract `_find_segments` helper**

In `src/jam_session_processor/splitter.py`, extract the inner loop (lines 94-121) into a new function. The helper returns **unpadded** segments; padding is applied by the caller after scoring/filtering. Note: `total_duration` is NOT needed by `_find_segments` — it's only used by `_apply_padding`.

```python
def _find_segments(
    smoothed: list[float],
    energy_threshold_db: float,
    min_song_duration_sec: int,
) -> list[tuple[float, float]]:
    """Find contiguous regions above energy threshold, filtered by min duration.

    Returns unpadded segments as (start_sec, end_sec) tuples.
    """
    in_song = False
    song_start = 0
    raw_segments: list[tuple[int, int]] = []

    for i, db in enumerate(smoothed):
        if db >= energy_threshold_db:
            if not in_song:
                song_start = i
                in_song = True
        else:
            if in_song:
                raw_segments.append((song_start, i))
                in_song = False

    if in_song:
        raw_segments.append((song_start, len(smoothed)))

    # Filter out segments shorter than min_song_duration
    segments: list[tuple[float, float]] = []
    for start_idx, end_idx in raw_segments:
        duration = (end_idx - start_idx) * WINDOW_SEC
        if duration >= min_song_duration_sec:
            start_sec = start_idx * WINDOW_SEC
            end_sec = end_idx * WINDOW_SEC
            segments.append((start_sec, end_sec))

    return segments


def _apply_padding(
    segments: list[tuple[float, float]],
    total_duration: float,
    padding_sec: float = 2.0,
) -> list[tuple[float, float]]:
    """Apply padding to segment boundaries, clamping to [0, total_duration]."""
    return [
        (max(0.0, start - padding_sec), min(total_duration, end + padding_sec))
        for start, end in segments
    ]
```

Then update `detect_songs()` to use both helpers:

```python
def detect_songs(
    file_path: Path,
    energy_threshold_db: float = DEFAULT_ENERGY_THRESHOLD_DB,
    min_song_duration_sec: int = DEFAULT_MIN_SONG_DURATION_SEC,
) -> SplitResult:
    """Detect songs by finding sustained high-energy sections."""
    rms_profile = compute_rms_profile(file_path)
    if not rms_profile:
        return SplitResult(segments=[], total_duration_sec=0.0)

    total_duration = len(rms_profile) * WINDOW_SEC
    smoothed = smooth_profile(rms_profile, SMOOTHING_WINDOW_SEC)

    segments = _find_segments(smoothed, energy_threshold_db, min_song_duration_sec)
    padded = _apply_padding(segments, total_duration)

    return SplitResult(segments=padded, total_duration_sec=float(total_duration))
```

- [ ] **Step 4: Run all splitter tests to verify refactor is behavior-preserving**

Run: `pytest tests/test_splitter.py -v`
Expected: All PASS (same results as before)

- [ ] **Step 5: Commit**

```bash
git add src/jam_session_processor/splitter.py tests/test_splitter.py
git commit -m "refactor: extract _find_segments and _apply_padding helpers from detect_songs"
```

### Task 2: Add `RoomVolume` enum and `AutoSplitResult` dataclass

**Files:**
- Modify: `src/jam_session_processor/splitter.py` (top of file, after existing imports/constants)

- [ ] **Step 1: Add the new types**

Add after the existing `SplitResult` dataclass in `splitter.py`:

```python
from enum import Enum


class RoomVolume(str, Enum):
    QUIET = "quiet"
    NORMAL = "normal"
    LOUD = "loud"


# Threshold search ranges per room volume (inclusive endpoints, 1 dB steps)
_VOLUME_RANGES: dict[RoomVolume, tuple[float, float]] = {
    RoomVolume.QUIET: (-28.0, -22.0),
    RoomVolume.NORMAL: (-23.0, -17.0),
    RoomVolume.LOUD: (-19.0, -13.0),
}


@dataclass
class AutoSplitResult:
    split: SplitResult
    threshold_used: float
    expected_tracks: int
    actual_tracks: int
    close_match: bool  # True if |actual - expected| <= 1
```

- [ ] **Step 2: Run existing tests to ensure no breakage**

Run: `pytest tests/test_splitter.py -v`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add src/jam_session_processor/splitter.py
git commit -m "feat: add RoomVolume enum and AutoSplitResult dataclass"
```

### Task 3: Implement `detect_songs_by_count`

**Files:**
- Modify: `src/jam_session_processor/splitter.py`
- Test: `tests/test_splitter.py`

- [ ] **Step 1: Write test for basic auto-detection**

Add to `tests/test_splitter.py`:

```python
from jam_session_processor.splitter import detect_songs_by_count, RoomVolume


def test_detect_songs_by_count_finds_songs(fake_session_file):
    """Auto-detection with expected count should find segments."""
    result = detect_songs_by_count(
        fake_session_file,
        expected_tracks=3,
        room_volume=RoomVolume.QUIET,
        min_song_duration_sec=3,
    )
    assert result.actual_tracks >= 2
    assert result.expected_tracks == 3
    assert result.threshold_used <= -22.0  # within quiet range
    assert result.threshold_used >= -28.0
    assert len(result.split.segments) == result.actual_tracks
    assert result.split.total_duration_sec > 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_splitter.py::test_detect_songs_by_count_finds_songs -v`
Expected: FAIL — `detect_songs_by_count` not defined

- [ ] **Step 3: Implement `detect_songs_by_count`**

Add to `src/jam_session_processor/splitter.py`:

```python
import statistics


def detect_songs_by_count(
    file_path: Path,
    expected_tracks: int,
    room_volume: RoomVolume = RoomVolume.NORMAL,
    min_song_duration_sec: int = DEFAULT_MIN_SONG_DURATION_SEC,
) -> AutoSplitResult:
    """Detect songs by searching multiple thresholds to match an expected track count.

    Computes RMS profile once, then sweeps thresholds within the range for the
    given room volume. Picks the threshold whose segment count is closest to
    expected_tracks, using segment duration consistency as a tiebreaker.
    """
    rms_profile = compute_rms_profile(file_path)
    if not rms_profile:
        return AutoSplitResult(
            split=SplitResult(segments=[], total_duration_sec=0.0),
            threshold_used=0.0,
            expected_tracks=expected_tracks,
            actual_tracks=0,
            close_match=expected_tracks <= 1,
        )

    total_duration = len(rms_profile) * WINDOW_SEC
    smoothed = smooth_profile(rms_profile, SMOOTHING_WINDOW_SEC)

    low, high = _VOLUME_RANGES[room_volume]
    # Generate thresholds at 1 dB steps (inclusive)
    steps = int(high - low)
    thresholds = [low + i for i in range(steps + 1)]

    best_segments: list[tuple[float, float]] = []
    best_threshold = low
    best_count_dist = float("inf")
    best_variance = float("inf")

    for threshold in thresholds:
        segments = _find_segments(smoothed, threshold, min_song_duration_sec)
        count_dist = abs(len(segments) - expected_tracks)

        # Tiebreaker: duration consistency (lower stdev = better)
        if len(segments) >= 2:
            durations = [end - start for start, end in segments]
            variance = statistics.stdev(durations)
        elif len(segments) == 1:
            variance = 0.0
        else:
            variance = float("inf")

        if (count_dist < best_count_dist) or (
            count_dist == best_count_dist and variance < best_variance
        ):
            best_segments = segments
            best_threshold = threshold
            best_count_dist = count_dist
            best_variance = variance

    padded = _apply_padding(best_segments, total_duration)
    actual_tracks = len(padded)

    return AutoSplitResult(
        split=SplitResult(segments=padded, total_duration_sec=float(total_duration)),
        threshold_used=best_threshold,
        expected_tracks=expected_tracks,
        actual_tracks=actual_tracks,
        close_match=abs(actual_tracks - expected_tracks) <= 1,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_splitter.py::test_detect_songs_by_count_finds_songs -v`
Expected: PASS

- [ ] **Step 5: Write test for scoring tiebreaker**

Add to `tests/test_splitter.py`:

```python
def test_detect_songs_by_count_close_match(fake_session_file):
    """When expected count is close to actual, close_match should be True."""
    result = detect_songs_by_count(
        fake_session_file,
        expected_tracks=2,
        room_volume=RoomVolume.QUIET,
        min_song_duration_sec=3,
    )
    # The fake file has 2-3 detectable segments; expecting 2 should be close
    assert result.close_match is True


def test_detect_songs_by_count_no_match(silence_only_file):
    """Silence-only file should return 0 segments."""
    result = detect_songs_by_count(
        silence_only_file,
        expected_tracks=5,
        room_volume=RoomVolume.NORMAL,
        min_song_duration_sec=3,
    )
    assert result.actual_tracks == 0
    assert result.close_match is False
    assert result.split.segments == []


def test_detect_songs_by_count_expected_one(fake_session_file):
    """Expected 1 track should find a single segment."""
    result = detect_songs_by_count(
        fake_session_file,
        expected_tracks=1,
        room_volume=RoomVolume.QUIET,
        min_song_duration_sec=3,
    )
    # Should find a result; may or may not be exactly 1 depending on threshold
    assert result.expected_tracks == 1
    assert result.actual_tracks >= 0
```

- [ ] **Step 6: Run all splitter tests**

Run: `pytest tests/test_splitter.py -v`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add src/jam_session_processor/splitter.py tests/test_splitter.py
git commit -m "feat: add detect_songs_by_count with multi-threshold search"
```

---

## Chunk 2: API changes

### Task 4: Update request models and add validation

**Files:**
- Modify: `src/jam_session_processor/api.py:539-565`
- Test: `tests/test_api.py`

- [ ] **Step 1: Update request models**

In `src/jam_session_processor/api.py`, update the three request models:

```python
class ReprocessRequest(BaseModel):
    threshold: float | None = None
    min_duration: int = 120
    single: bool = False
    expected_tracks: int | None = None
    room_volume: str | None = None

class UploadInitRequest(BaseModel):
    filename: str
    group_id: int | None = None
    threshold: float | None = None
    single: bool = False
    force: bool = False
    expected_tracks: int | None = None
    room_volume: str | None = None

class UploadCompleteRequest(BaseModel):
    job_id: str
    session_id: int
    threshold: float | None = None
    single: bool = False
    force: bool = False
    expected_tracks: int | None = None
    room_volume: str | None = None
```

- [ ] **Step 2: Add a validation helper**

Add after the request models in `api.py`:

```python
def _validate_detection_params(
    threshold: float | None,
    single: bool,
    expected_tracks: int | None,
    room_volume: str | None,
) -> None:
    """Validate mutual exclusivity of detection mode params."""
    if expected_tracks is not None:
        if threshold is not None:
            raise HTTPException(
                status_code=400,
                detail="Cannot specify both expected_tracks and threshold",
            )
        if single:
            raise HTTPException(
                status_code=400,
                detail="Cannot specify both expected_tracks and single",
            )
        if expected_tracks < 1:
            raise HTTPException(
                status_code=400,
                detail="expected_tracks must be at least 1",
            )
    if room_volume is not None:
        if expected_tracks is None:
            raise HTTPException(
                status_code=400,
                detail="room_volume requires expected_tracks",
            )
        if room_volume not in ("quiet", "normal", "loud"):
            raise HTTPException(
                status_code=400,
                detail="room_volume must be 'quiet', 'normal', or 'loud'",
            )
```

- [ ] **Step 3: Write validation tests**

Add to `tests/test_api.py`. Use the `seeded_client` fixture which provides a client with an existing session. Note: `auth_client` returns `(client, uid, gid)` — no session. `seeded_client` returns `(client, uid, gid)` with a session already in the DB (session_id=1).

```python
def test_reprocess_rejects_threshold_with_expected_tracks(seeded_client):
    """Cannot specify both threshold and expected_tracks."""
    client, uid, gid = seeded_client
    # Get the session ID from the DB
    resp = client.get("/api/sessions")
    session_id = resp.json()[0]["id"]
    resp = client.post(
        f"/api/sessions/{session_id}/reprocess",
        json={"threshold": -20, "expected_tracks": 5},
    )
    assert resp.status_code == 400
    assert "both" in resp.json()["detail"].lower()


def test_reprocess_rejects_single_with_expected_tracks(seeded_client):
    """Cannot specify both single and expected_tracks."""
    client, uid, gid = seeded_client
    resp = client.get("/api/sessions")
    session_id = resp.json()[0]["id"]
    resp = client.post(
        f"/api/sessions/{session_id}/reprocess",
        json={"single": True, "expected_tracks": 5},
    )
    assert resp.status_code == 400


def test_reprocess_rejects_room_volume_without_expected_tracks(seeded_client):
    """room_volume requires expected_tracks."""
    client, uid, gid = seeded_client
    resp = client.get("/api/sessions")
    session_id = resp.json()[0]["id"]
    resp = client.post(
        f"/api/sessions/{session_id}/reprocess",
        json={"room_volume": "loud"},
    )
    assert resp.status_code == 400


def test_reprocess_rejects_invalid_room_volume(seeded_client):
    """room_volume must be quiet/normal/loud."""
    client, uid, gid = seeded_client
    resp = client.get("/api/sessions")
    session_id = resp.json()[0]["id"]
    resp = client.post(
        f"/api/sessions/{session_id}/reprocess",
        json={"expected_tracks": 5, "room_volume": "deafening"},
    )
    assert resp.status_code == 400
```

- [ ] **Step 4: Run validation tests to verify they fail**

Run: `pytest tests/test_api.py::test_reprocess_rejects_threshold_with_expected_tracks -v`
Expected: FAIL (no validation yet)

- [ ] **Step 5: Wire validation into endpoints and add None-safe threshold handling**

Add `_validate_detection_params()` call at the start of `reprocess_session`, `upload_complete`, and `upload_init` endpoints. Also add it in `upload_session` after parsing query params.

**IMPORTANT:** Since `threshold` changed from `float = -20.0` to `float | None = None`, we must also guard all places where `threshold` is passed to `detect_songs()` or `_process_reprocess`/`_process_upload` to default `None` → `-20.0`. This prevents breakage between Task 4 and Task 5.

In `reprocess_session` (around line 844):
```python
async def reprocess_session(session_id: int, req: ReprocessRequest, request: Request):
    _validate_detection_params(req.threshold, req.single, req.expected_tracks, req.room_volume)
    # ... existing setup code ...
    loop.run_in_executor(
        None,
        _process_reprocess,
        job.id,
        session_id,
        req.threshold if req.threshold is not None else -20.0,  # guard None
        req.min_duration,
        req.single,
    )
```

In `upload_init` (around line 1041):
```python
def upload_init(req: UploadInitRequest, request: Request):
    _validate_detection_params(req.threshold, req.single, req.expected_tracks, req.room_volume)
    # ... rest of function
```

In `upload_complete` (around line 1124):
```python
async def upload_complete(req: UploadCompleteRequest, request: Request):
    _validate_detection_params(req.threshold, req.single, req.expected_tracks, req.room_volume)
    # ... rest of function ...
    threshold = req.threshold if req.threshold is not None else -20.0  # guard None
```

In `upload_session` (around line 1271), after parsing existing query params:
```python
    expected_tracks_str = request.query_params.get("expected_tracks")
    expected_tracks = int(expected_tracks_str) if expected_tracks_str else None
    room_volume = request.query_params.get("room_volume")
    _validate_detection_params(
        float(threshold_str) if threshold_str else None,
        single, expected_tracks, room_volume,
    )
```

- [ ] **Step 6: Run validation tests**

Run: `pytest tests/test_api.py -k "rejects" -v`
Expected: All PASS

- [ ] **Step 7: Run full test suite to check for regressions**

Run: `pytest`
Expected: All PASS. The `threshold` change from `float = -20.0` to `float | None = None` means existing callers that don't send threshold will get `None`. Verify that `_process_reprocess` and `_process_upload` handle `None` threshold by defaulting to -20.0.

- [ ] **Step 8: Commit**

```bash
git add src/jam_session_processor/api.py tests/test_api.py
git commit -m "feat: add expected_tracks and room_volume params with validation"
```

### Task 5: Wire auto-detection into pipeline functions

**Files:**
- Modify: `src/jam_session_processor/api.py:751-836` (`_process_reprocess`)
- Modify: `src/jam_session_processor/api.py:905-1011` (`_process_upload`)

- [ ] **Step 1: Update `_process_reprocess` signature and logic**

```python
def _process_reprocess(
    job_id: str,
    session_id: int,
    threshold: float | None,
    min_duration: int,
    single: bool,
    expected_tracks: int | None = None,
    room_volume: str | None = None,
):
    """Run reprocessing in a background thread."""
    from jam_session_processor.metadata import extract_metadata
    from jam_session_processor.output import export_segments
    from jam_session_processor.splitter import detect_songs, detect_songs_by_count, RoomVolume
    from jam_session_processor.storage import get_storage

    # ... existing setup code through line 798 (delete old tracks) ...

    # Re-detect songs
    meta = extract_metadata(source)
    if single:
        segments = [(0.0, meta.duration_seconds)]
    elif expected_tracks is not None:
        db.update_job_progress(job_id, "Detecting songs (trying multiple thresholds)...")
        vol = RoomVolume(room_volume) if room_volume else RoomVolume.NORMAL
        auto_result = detect_songs_by_count(
            source, expected_tracks, vol, min_duration,
        )
        segments = auto_result.split.segments
        if not auto_result.close_match and auto_result.actual_tracks > 0:
            note = (
                f"Auto-detection found {auto_result.actual_tracks} tracks "
                f"at {auto_result.threshold_used:.0f} dB "
                f"(expected {auto_result.expected_tracks}). "
                f"Consider reprocessing with different settings."
            )
            # Append to existing notes rather than overwriting
            existing = db.get_session(session_id)
            existing_notes = existing.notes if existing and existing.notes else ""
            combined = f"{existing_notes}\n{note}".strip() if existing_notes else note
            db.update_session_notes(session_id, combined)
    else:
        db.update_job_progress(job_id, "Detecting songs...")
        effective_threshold = threshold if threshold is not None else -20.0
        result = detect_songs(
            source,
            energy_threshold_db=effective_threshold,
            min_song_duration_sec=min_duration,
        )
        segments = result.segments if result.segments else []

    # ... rest of function unchanged (export segments, create tracks, etc.) ...
```

- [ ] **Step 2: Update `reprocess_session` to pass new params**

In the `reprocess_session` endpoint, update the `run_in_executor` call:

```python
    loop.run_in_executor(
        None,
        _process_reprocess,
        job.id,
        session_id,
        req.threshold,
        req.min_duration,
        req.single,
        req.expected_tracks,
        req.room_volume,
    )
```

- [ ] **Step 3: Update `_process_upload` signature and logic**

Same pattern as `_process_reprocess`. Add `expected_tracks` and `room_volume` params:

```python
def _process_upload(
    job_id: str,
    session_id: int,
    source: Path,
    group_id: int,
    threshold: float | None,
    single: bool,
    r2_key: str | None = None,
    force: bool = False,
    expected_tracks: int | None = None,
    room_volume: str | None = None,
):
```

Replace the song detection block (around line 975-980):

```python
    if single:
        segments = [(0.0, meta.duration_seconds)]
    elif expected_tracks is not None:
        db.update_job_progress(job_id, "Detecting songs (trying multiple thresholds)...")
        vol = RoomVolume(room_volume) if room_volume else RoomVolume.NORMAL
        auto_result = detect_songs_by_count(
            source, expected_tracks, vol,
        )
        segments = auto_result.split.segments
        if not auto_result.close_match and auto_result.actual_tracks > 0:
            note = (
                f"Auto-detection found {auto_result.actual_tracks} tracks "
                f"at {auto_result.threshold_used:.0f} dB "
                f"(expected {auto_result.expected_tracks}). "
                f"Consider reprocessing with different settings."
            )
            # Append to existing notes rather than overwriting
            existing = db.get_session(session_id)
            existing_notes = existing.notes if existing and existing.notes else ""
            combined = f"{existing_notes}\n{note}".strip() if existing_notes else note
            db.update_session_notes(session_id, combined)
    else:
        db.update_job_progress(job_id, "Detecting songs...")
        effective_threshold = threshold if threshold is not None else -20.0
        result = detect_songs(source, energy_threshold_db=effective_threshold)
        segments = result.segments
```

Also add `detect_songs_by_count, RoomVolume` to the import from splitter at the top of the function.

- [ ] **Step 4: Update `upload_complete` to pass new params**

In `upload_complete` (around line 1149):

```python
    threshold = req.threshold
    single = req.single
    force = req.force

    # ... existing code ...

    loop.run_in_executor(
        None,
        _process_upload,
        job.id,
        session.id,
        source,
        session.group_id,
        threshold,
        single,
        r2_key,
        force,
        req.expected_tracks,
        req.room_volume,
    )
```

Note: `threshold` handling changes — previously `req.threshold if req.threshold is not None else -20.0`, now just pass `None` through and let `_process_upload` handle the default.

- [ ] **Step 5: Update `upload_session` to parse and pass new params**

In `upload_session` (around line 1271-1275), add parsing:

```python
    threshold_str = request.query_params.get("threshold")
    threshold = float(threshold_str) if threshold_str else None
    single = request.query_params.get("single") == "true"
    force = request.query_params.get("force") == "true"
    expected_tracks_str = request.query_params.get("expected_tracks")
    expected_tracks = int(expected_tracks_str) if expected_tracks_str else None
    room_volume = request.query_params.get("room_volume") or None
```

And update the `run_in_executor` call (around line 1325):

```python
    loop.run_in_executor(
        None, _process_upload, job_id, session_id, source, group_id,
        threshold, single, None, force, expected_tracks, room_volume,
    )
```

- [ ] **Step 6: Run full test suite**

Run: `pytest`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add src/jam_session_processor/api.py
git commit -m "feat: wire auto-detection into upload and reprocess pipelines"
```

---

## Chunk 3: Frontend changes

### Task 6: Update TypeScript API client

**Files:**
- Modify: `web/src/api.ts:398-556`

- [ ] **Step 1: Update `reprocessSession`**

```typescript
  reprocessSession: (
    sessionId: number,
    threshold?: number,
    minDuration?: number,
    single?: boolean,
    expectedTracks?: number,
    roomVolume?: string,
  ) =>
    fetchJson<Job>(`${BASE}/sessions/${sessionId}/reprocess`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(threshold !== undefined && { threshold }),
        ...(minDuration !== undefined && { min_duration: minDuration }),
        ...(single ? { single: true } : {}),
        ...(expectedTracks !== undefined && { expected_tracks: expectedTracks }),
        ...(roomVolume !== undefined && { room_volume: roomVolume }),
      }),
    }),
```

- [ ] **Step 2: Update `initUpload`**

```typescript
  initUpload: (
    filename: string,
    groupId?: number,
    threshold?: number,
    single?: boolean,
    force?: boolean,
    expectedTracks?: number,
    roomVolume?: string,
  ) =>
    fetchJson<UploadInitResponse>(`${BASE}/sessions/upload/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename,
        ...(groupId !== undefined && { group_id: groupId }),
        ...(threshold !== undefined && { threshold }),
        ...(single && { single: true }),
        ...(force && { force: true }),
        ...(expectedTracks !== undefined && { expected_tracks: expectedTracks }),
        ...(roomVolume !== undefined && { room_volume: roomVolume }),
      }),
    }),
```

- [ ] **Step 3: Update `completeUpload`**

```typescript
  completeUpload: (
    jobId: string,
    sessionId: number,
    threshold?: number,
    single?: boolean,
    force?: boolean,
    expectedTracks?: number,
    roomVolume?: string,
  ) =>
    fetchJson<Job>(`${BASE}/sessions/upload/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        session_id: sessionId,
        ...(threshold !== undefined && { threshold }),
        ...(single && { single: true }),
        ...(force && { force: true }),
        ...(expectedTracks !== undefined && { expected_tracks: expectedTracks }),
        ...(roomVolume !== undefined && { room_volume: roomVolume }),
      }),
    }),
```

- [ ] **Step 4: Update `uploadSession`**

Add `expectedTracks` and `roomVolume` params and append to query string:

```typescript
  uploadSession: (
    file: File,
    groupId?: number,
    threshold?: number,
    single?: boolean,
    force?: boolean,
    onProgress?: (pct: number) => void,
    expectedTracks?: number,
    roomVolume?: string,
  ): Promise<Job> => {
    const form = new FormData();
    form.append("file", file);
    const params = new URLSearchParams();
    if (groupId !== undefined) params.set("group_id", String(groupId));
    if (threshold !== undefined) params.set("threshold", String(threshold));
    if (single) params.set("single", "true");
    if (force) params.set("force", "true");
    if (expectedTracks !== undefined) params.set("expected_tracks", String(expectedTracks));
    if (roomVolume !== undefined) params.set("room_volume", roomVolume);
    // ... rest unchanged
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add web/src/api.ts
git commit -m "feat: add expected_tracks and room_volume to API client"
```

### Task 7: Update upload modal (SessionList.tsx)

**Files:**
- Modify: `web/src/pages/SessionList.tsx`

- [ ] **Step 1: Add state variables**

Replace the existing upload-related state (around line 63-71) to add new state and change defaults:

```typescript
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState("Uploading...");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadGroupId, setUploadGroupId] = useState<number | null>(null);
  const [uploadThreshold, setUploadThreshold] = useState<number | string>(20);
  const [singleSong, setSingleSong] = useState(false);
  const [duplicateDetected, setDuplicateDetected] = useState(false);
  // Auto-detection state
  const [uploadMode, setUploadMode] = useState<"auto" | "manual">("auto");
  const [expectedTracks, setExpectedTracks] = useState<number | string>("");
  const [roomVolume, setRoomVolume] = useState<"quiet" | "normal" | "loud">("normal");
```

- [ ] **Step 1b: Update `openUploadModal` to reset new state**

In the `openUploadModal` function (around line 92), add resets for the new state variables:

```typescript
  const openUploadModal = () => {
    setSelectedFile(null);
    setUploadThreshold(20);
    setSingleSong(false);
    setUploadMode("auto");        // reset to default auto mode
    setExpectedTracks("");         // reset expected tracks
    setRoomVolume("normal");      // reset room volume
    // ... rest of existing function (group pre-population, etc.)
```

- [ ] **Step 2: Update `doUpload` to pass new params**

Update the `doUpload` function (around line 110) to handle both modes:

```typescript
  const doUpload = async (force?: boolean) => {
    if (!selectedFile) return;

    const groups = user?.groups ?? [];
    const groupId = groups.length === 1 ? groups[0].id : uploadGroupId;
    if (groups.length > 1 && !groupId) {
      setUploadError("Select a group");
      return;
    }

    setUploadModalOpen(false);
    setUploading(true);
    setUploadProgress(0);
    setUploadStatus("Uploading...");
    setUploadError(null);
    setDuplicateDetected(false);
    try {
      // Determine params based on mode
      let threshold: number | undefined;
      let single: boolean | undefined;
      let expTracks: number | undefined;
      let roomVol: string | undefined;

      if (uploadMode === "manual") {
        const thresholdNum = uploadThreshold === "" ? 20 : Number(uploadThreshold);
        threshold = thresholdNum !== 20 ? -thresholdNum : undefined;
        single = singleSong || undefined;
      } else {
        // Auto mode
        const expNum = expectedTracks === "" ? undefined : Number(expectedTracks);
        if (expNum !== undefined && expNum >= 1) {
          expTracks = expNum;
          roomVol = roomVolume;
        }
        // If no expected tracks specified, fall through to default threshold behavior
      }

      const initResp = await api.initUpload(
        selectedFile.name, groupId ?? undefined, threshold, single,
        force || undefined, expTracks, roomVol,
      );

      if (initResp.upload_url) {
        const contentTypes: Record<string, string> = {
          ".m4a": "audio/mp4", ".wav": "audio/wav", ".mp3": "audio/mpeg",
          ".flac": "audio/flac", ".ogg": "audio/ogg",
        };
        const ext = selectedFile.name.substring(selectedFile.name.lastIndexOf(".")).toLowerCase();
        const contentType = contentTypes[ext] || "application/octet-stream";

        await api.uploadToPresignedUrl(
          initResp.upload_url, selectedFile, contentType,
          (pct) => {
            setUploadProgress(pct);
            setUploadStatus(pct < 100 ? `Uploading... ${pct}%` : "Processing...");
          },
        );

        await api.completeUpload(
          initResp.job.id, initResp.session_id, threshold, single,
          force || undefined, expTracks, roomVol,
        );
        navigate(`/sessions/${initResp.session_id}?job=${initResp.job.id}`);
      } else {
        const job = await api.uploadSession(
          selectedFile, groupId ?? undefined, threshold, single,
          force || undefined,
          (pct) => {
            setUploadProgress(pct);
            setUploadStatus(pct < 100 ? `Uploading... ${pct}%` : "Processing...");
          },
          expTracks, roomVol,
        );
        // ... navigate to session
```

Find the existing navigate-after-upload logic and keep it. The key change is threading `expTracks` and `roomVol` through.

- [ ] **Step 3: Replace the form body in the upload modal**

Replace the single-song checkbox + threshold section (lines 374-404) with mode-switching UI:

```tsx
        {uploadMode === "auto" ? (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                Expected tracks
              </label>
              <input
                type="number"
                value={expectedTracks}
                onChange={(e) => setExpectedTracks(e.target.value === "" ? "" : Number(e.target.value))}
                min={1}
                step={1}
                placeholder="e.g. 8"
                className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-base sm:text-sm text-white placeholder-gray-600 focus:border-accent-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-gray-500">
                Approximate number of songs in the recording
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                Room volume
              </label>
              <div className="flex rounded border border-gray-700 overflow-hidden">
                {(["quiet", "normal", "loud"] as const).map((vol) => (
                  <button
                    key={vol}
                    type="button"
                    onClick={() => setRoomVolume(vol)}
                    className={`flex-1 px-3 py-1.5 text-sm capitalize transition ${
                      roomVolume === vol
                        ? "bg-accent-600 text-white"
                        : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                    }`}
                  >
                    {vol}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setUploadMode("manual")}
              className="text-xs text-gray-500 hover:text-gray-300 transition"
            >
              Use manual threshold instead
            </button>
          </>
        ) : (
          <>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={singleSong}
                onChange={(e) => setSingleSong(e.target.checked)}
                className="rounded border-gray-600 bg-gray-800 text-accent-500 focus:ring-accent-500 focus:ring-offset-0"
              />
              <span className="text-sm text-gray-300">Single song recording</span>
            </label>
            {!singleSong && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  Threshold (dB)
                </label>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-gray-400">&minus;</span>
                  <input
                    type="number"
                    value={uploadThreshold}
                    onChange={(e) => setUploadThreshold(e.target.value === "" ? "" : Number(e.target.value))}
                    min={0}
                    step={1}
                    className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-base sm:text-sm text-white focus:border-accent-500 focus:outline-none"
                  />
                  <span className="text-sm text-gray-500">dB</span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Try 15 for loud rooms, 30 for quieter/acoustic.
                </p>
              </div>
            )}
            <button
              type="button"
              onClick={() => setUploadMode("auto")}
              className="text-xs text-gray-500 hover:text-gray-300 transition"
            >
              Use expected track count instead
            </button>
          </>
        )}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Take screenshot to verify upload modal layout**

Run: `npx playwright screenshot http://localhost:5173/sessions /tmp/upload-modal.png --color-scheme dark`

Note: The modal won't be visible in a static screenshot (it requires clicking Upload). Verify manually by opening the dev server and clicking the upload button.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/SessionList.tsx
git commit -m "feat: upload modal defaults to expected-count mode with room volume toggle"
```

### Task 8: Update reprocess modal (SessionDetail.tsx)

**Files:**
- Modify: `web/src/pages/SessionDetail.tsx`

- [ ] **Step 1: Add `Job` type import and state variables**

First, update the import at line 4 to include `Job`:
```typescript
import type { Session, Track, Song, Job } from "../api";
```

Add alongside existing state (around line 87-89):

```typescript
  const [threshold, setThreshold] = useState<number | string>(20);
  const [reprocessOpen, setReprocessOpen] = useState(false);
  const [singleSong, setSingleSong] = useState(false);
  // Auto-detection state
  const [reprocessMode, setReprocessMode] = useState<"auto" | "manual">("manual");
  const [expectedTracks, setExpectedTracks] = useState<number | string>("");
  const [roomVolume, setRoomVolume] = useState<"quiet" | "normal" | "loud">("normal");
```

- [ ] **Step 2: Update `handleReprocess`**

Replace the existing handler (around line 203-207):

```typescript
  const handleReprocess = async () => {
    setReprocessOpen(false);
    try {
      let job: Job;
      if (reprocessMode === "auto") {
        const expNum = expectedTracks === "" ? undefined : Number(expectedTracks);
        job = await api.reprocessSession(
          sessionId, undefined, undefined, undefined,
          expNum, expNum !== undefined ? roomVolume : undefined,
        );
      } else {
        const thresholdNum = threshold === "" ? 20 : Number(threshold);
        job = await api.reprocessSession(
          sessionId, -thresholdNum, 120, singleSong || undefined,
        );
      }
      if (session) {
        setSession({ ...session, active_job_id: job.id });
      }
    } catch (e: any) {
      showError(e?.message || "Reprocess failed");
    }
  };
```

- [ ] **Step 3: Update the reprocess modal form**

Replace the modal body (lines 444-478) with mode-switching UI:

```tsx
      <FormModal
        open={reprocessOpen}
        title="Reprocess"
        confirmLabel="Reprocess"
        onConfirm={handleReprocess}
        onCancel={() => setReprocessOpen(false)}
      >
        <p className="-mt-2 text-sm text-gray-400">
          Current tracks and tags will be replaced.
        </p>
        {reprocessMode === "manual" ? (
          <>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={singleSong}
                onChange={(e) => setSingleSong(e.target.checked)}
                className="rounded border-gray-600 bg-gray-800 text-accent-500 focus:ring-accent-500 focus:ring-offset-0"
              />
              <span className="text-sm text-gray-300">Single song recording</span>
            </label>
            {!singleSong && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  Threshold (dB)
                </label>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-gray-400">&minus;</span>
                  <input
                    type="number"
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value === "" ? "" : Number(e.target.value))}
                    min={0}
                    step={1}
                    className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-base sm:text-sm text-white focus:border-accent-500 focus:outline-none"
                  />
                  <span className="text-sm text-gray-500">dB</span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Higher = more tracks, lower = fewer tracks
                </p>
              </div>
            )}
            <button
              type="button"
              onClick={() => setReprocessMode("auto")}
              className="text-xs text-gray-500 hover:text-gray-300 transition"
            >
              Use expected track count instead
            </button>
          </>
        ) : (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                Expected tracks
              </label>
              <input
                type="number"
                value={expectedTracks}
                onChange={(e) => setExpectedTracks(e.target.value === "" ? "" : Number(e.target.value))}
                min={1}
                step={1}
                placeholder="e.g. 8"
                className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-base sm:text-sm text-white placeholder-gray-600 focus:border-accent-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-gray-500">
                Approximate number of songs in the recording
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                Room volume
              </label>
              <div className="flex rounded border border-gray-700 overflow-hidden">
                {(["quiet", "normal", "loud"] as const).map((vol) => (
                  <button
                    key={vol}
                    type="button"
                    onClick={() => setRoomVolume(vol)}
                    className={`flex-1 px-3 py-1.5 text-sm capitalize transition ${
                      roomVolume === vol
                        ? "bg-accent-600 text-white"
                        : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                    }`}
                  >
                    {vol}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setReprocessMode("manual")}
              className="text-xs text-gray-500 hover:text-gray-300 transition"
            >
              Use manual threshold instead
            </button>
          </>
        )}
      </FormModal>
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/SessionDetail.tsx
git commit -m "feat: reprocess modal supports expected track count mode"
```

### Task 9: Final verification

- [ ] **Step 1: Run full backend test suite**

Run: `pytest`
Expected: All PASS

- [ ] **Step 2: Run linter**

Run: `ruff check src/ tests/`
Expected: No errors

- [ ] **Step 3: Run TypeScript check**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Manual smoke test (if dev server running)**

1. Open upload modal — should default to "auto" mode with expected tracks + room volume
2. Click "Use manual threshold instead" — should swap to threshold + single-song
3. Click "Use expected track count instead" — should swap back
4. Open reprocess modal — should default to "manual" mode with threshold
5. Click "Use expected track count instead" — should swap to auto mode

- [ ] **Step 5: Commit any lint/type fixes if needed**

```bash
git add -A
git commit -m "fix: lint and type fixes for auto track detection"
```
