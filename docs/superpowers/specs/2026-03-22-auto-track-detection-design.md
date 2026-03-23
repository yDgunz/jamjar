# Auto Track Detection by Expected Count

## Problem

Track extraction from jam session recordings often requires multiple reprocessing attempts to get the right dB threshold. Users know roughly how many songs they played but not the right energy threshold for their room/recording setup.

## Solution

Allow users to specify an expected track count instead of a raw dB threshold. The system tries multiple thresholds within a range determined by a "room volume" hint (Quiet/Normal/Loud), scores the results, and picks the best match.

## Design Decisions

- **Expected count is a hint, not a constraint.** The system presents the best result even if it can't match the count exactly.
- **Upload defaults to expected-count mode; reprocess defaults to manual threshold.** New uploads benefit from guided detection; reprocessing is for deliberate fine-tuning.
- **Room volume replaces raw dB** when in expected-count mode. Three levels (Quiet/Normal/Loud) map to threshold search ranges.
- **If the result is far from expected**, the system adds a note to the session rather than blocking or prompting for confirmation.
- **Expected-count and manual-threshold are mutually exclusive.** The API rejects requests that specify both.

## Splitter Changes

### New types

```python
class RoomVolume(str, Enum):
    QUIET = "quiet"       # threshold range: -28 to -22
    NORMAL = "normal"     # threshold range: -23 to -17
    LOUD = "loud"         # threshold range: -19 to -13

@dataclass
class AutoSplitResult:
    split: SplitResult              # best segments + total_duration
    threshold_used: float           # the dB threshold that won
    expected_tracks: int            # what the user asked for
    actual_tracks: int              # what we found
    close_match: bool               # True if |actual - expected| <= 1
```

### Refactored detection logic

Extract the inner segment-detection loop from `detect_songs()` into a shared helper:

```python
def _find_segments(
    smoothed: list[float],
    energy_threshold_db: float,
    min_song_duration_sec: int,
    total_duration: float,
) -> list[tuple[float, float]]:
```

This takes the already-computed smoothed profile and returns **unpadded** segments (raw start/end from the energy detection). Padding (2 seconds) is applied after scoring in `detect_songs_by_count()` and after filtering in `detect_songs()`. Using unpadded durations for scoring gives more meaningful variance comparison.

Both `detect_songs()` and `detect_songs_by_count()` call this helper, avoiding redundant RMS computation.

### New function: `detect_songs_by_count()`

```python
def detect_songs_by_count(
    file_path: Path,
    expected_tracks: int,
    room_volume: RoomVolume = RoomVolume.NORMAL,
    min_song_duration_sec: int = DEFAULT_MIN_SONG_DURATION_SEC,
) -> AutoSplitResult:
```

Algorithm:
1. Compute RMS profile once via `compute_rms_profile()`
2. Smooth once via `smooth_profile()`
3. Determine threshold range from `room_volume`:
   - Quiet: -28 to -22 dB
   - Normal: -23 to -17 dB
   - Loud: -19 to -13 dB
4. Generate 7 evenly-spaced thresholds (1 dB steps across 6 dB range, inclusive of endpoints)
5. For each threshold, call `_find_segments()` on the smoothed profile
6. Score each candidate:
   - Primary: `abs(len(segments) - expected_tracks)` — lower is better
   - Tiebreaker: standard deviation of segment durations — lower is better (more consistent segment lengths suggest natural song boundaries)
   - 0-segment results get infinite variance
7. Return `AutoSplitResult` with the winning candidate

## API Changes

### Request models — new optional fields

```python
class UploadInitRequest(BaseModel):
    # ... existing fields ...
    expected_tracks: int | None = None
    room_volume: str | None = None          # "quiet" | "normal" | "loud"

class UploadCompleteRequest(BaseModel):
    # ... existing fields ...
    expected_tracks: int | None = None
    room_volume: str | None = None

class ReprocessRequest(BaseModel):
    # ... existing fields ...
    expected_tracks: int | None = None
    room_volume: str | None = None
```

### Validation

To cleanly separate expected-count mode from manual-threshold mode, `threshold` becomes `float | None = None` in all request models (instead of defaulting to -20.0). This makes it unambiguous whether the user explicitly set a threshold.

- If both `expected_tracks` and `threshold` are provided, return 400.
- If both `expected_tracks` and `single` are provided, return 400.
- If `room_volume` is provided without `expected_tracks`, return 400.
- `expected_tracks` must be >= 1 if provided.
- `room_volume` must be one of "quiet", "normal", "loud" if provided.
- When neither `expected_tracks` nor `threshold` is provided, the pipeline uses the default threshold (-20 dB) as today.

### Pipeline changes

In `_process_upload()` and `_process_reprocess()`:

- If `expected_tracks` is provided: call `detect_songs_by_count(source, expected_tracks, room_volume, min_duration)`
- Otherwise: existing behavior with `detect_songs(source, threshold, min_duration)`
- When using auto-detection, update job progress to "Detecting songs (trying multiple thresholds)..."
- If `auto_result.close_match` is False, append a note to the session: "Auto-detection found N tracks (expected M). Consider reprocessing with different settings."

### Passthrough

The new params (`expected_tracks`, `room_volume`) are threaded through:
- `upload_init` → accepted but not persisted (params are re-sent in `upload_complete`)
- `upload_complete` → passed to `_process_upload`
- `upload_session` (direct multipart) → passed to `_process_upload`
- `reprocess_session` → passed to `_process_reprocess`

## Frontend Changes

### Upload modal (SessionList.tsx) — defaults to expected-count mode

- **Default view:** "Expected tracks" number input (optional, placeholder "e.g. 8") + "Room volume" 3-button toggle (Quiet / Normal / Loud, default: Normal)
- **"Use manual threshold" link** swaps to the current raw dB input + single-song checkbox
- **When in expected-count mode:** threshold and single-song fields hidden
- **When in manual mode:** expected-tracks and room-volume fields hidden

### Reprocess modal (SessionDetail.tsx) — defaults to manual threshold mode

- **Default view:** existing threshold + single-song fields (unchanged)
- **"Use expected track count" link** swaps to expected-count + room-volume fields
- Same mutual exclusivity as upload

### Post-processing feedback

When a session was processed with auto-detection and `close_match` is False, the session detail page shows a subtle info banner:

> "Auto-detection found X tracks (expected Y). You may want to reprocess with different settings."

This information comes from the session's `notes` field (where the backend appends the message).

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| `expected_tracks=1` | Effectively single-song mode; picks threshold yielding 1 segment |
| Very high `expected_tracks` (e.g., 20) | Searches normally, picks lowest threshold in range; note added if far off |
| All candidates yield 0 segments | Returns empty segments, note suggests trying different room volume or manual threshold |
| `room_volume` not provided with `expected_tracks` | Defaults to `NORMAL` |
| `single=True` with `expected_tracks` | 400 error — mutually exclusive |

**Note on `min_song_duration_sec`:** The default 120s minimum is kept for auto-detection. For sessions with many short tracks, users should use manual threshold mode where they can adjust min_duration via reprocess. This is a known limitation — auto mode is optimized for typical jam sessions with 3-10 songs of 3+ minutes each.

**Note on overlapping room volume ranges:** The ranges intentionally overlap (Quiet/Normal share -23 to -22, Normal/Loud share -19 to -17). This provides continuity between levels so edge-case recordings aren't missed by a gap between ranges.

**Note on `threshold_used`:** The `AutoSplitResult.threshold_used` value is included in the session notes alongside the close-match warning when applicable (e.g., "Auto-detection found 5 tracks at -19 dB (expected 8)"). This helps users pick a starting point if they want to manually reprocess.

## Frontend API Client

The TypeScript API client (`web/src/api.ts`) functions need updated signatures:
- `initUpload(filename, groupId, threshold, single, force, expectedTracks?, roomVolume?)`
- `completeUpload(jobId, sessionId, threshold, single, force, expectedTracks?, roomVolume?)`
- `uploadSession(file, groupId, threshold, single, force, onProgress, expectedTracks?, roomVolume?)`
- `reprocessSession(sessionId, threshold, minDuration, single, expectedTracks?, roomVolume?)`

## Testing

- **Unit: `_find_segments` helper** — extracted logic produces same results as before (regression test)
- **Unit: `detect_songs_by_count`** — synthetic RMS profiles with predictable segment counts at known thresholds; verify correct candidate is selected
- **Unit: scoring logic** — given two candidates with same count distance, verify lower duration variance wins
- **Unit: edge cases** — 0 segments, 1 expected track, all candidates equal
- **Integration: upload with `expected_tracks`** — verify job completes, correct number of tracks created
- **Integration: reprocess with `expected_tracks`** — verify old tracks replaced, new tracks created
- **Integration: validation** — verify 400 when both `threshold` and `expected_tracks` provided
