# Processing Pipeline

## Pipeline Steps

1. **Metadata extraction** — reads `.m4a`, `.wav`, `.mp3`, `.flac`, and `.ogg` files using mutagen. Recording date comes from iPhone `©day` tag, then filename parsing (`M-D-YY`, `M-D-YYYY`, `YYYY-MM-DD`).
2. **Song detection** — decodes to 8 kHz mono PCM via ffmpeg, computes per-second RMS energy, applies a 9-second rolling average, and finds sustained stretches (90+ seconds) at the recording's own playing level: within 7.5 dB of its 90th-percentile loudest second, so loud and quiet recordings split the same way with nothing to tune. Dips shorter than 8 seconds don't end a song. A recording that never gets above -50 dB has no songs. Can be skipped with single-song mode, which imports the entire file as one track.
3. **Export** — ffmpeg seek+split extracts each song to AAC (M4A container, 192kbps). No full-file loading.
4. **Storage** — exported tracks are saved locally and optionally uploaded to Cloudflare R2 (when configured).
5. **Database** — creates session and track records in SQLite with relative file paths.

## Trigger Points

Processing runs server-side via two API endpoints:

- **`POST /api/drive/import`** — import a file from a Google Drive folder shared with the app's service account. The server downloads it with the Drive API into `recordings/drive/<file id>/`, checks for a duplicate by duration (unless `force`), then runs the same processing job as an upload. The Drive file is recorded in `drive_imports` (imported / duplicate / skipped) so it isn't offered again.
- **`POST /api/sessions/upload`** — upload a new audio file; saves the file and returns a job ID (HTTP 202). Processing runs in a background thread. The frontend polls `GET /api/jobs/{id}` for real-time progress updates until the job completes or fails. Each job reports its current step, the tracks cut/saved so far, the songs found and a 96-point loudness profile of the recording (`jobs.detail`), which the recording page draws as a waveform being sliced into songs, with the elapsed time. When R2 storage is configured, local files are cleaned up after successful upload.
- **`POST /api/sessions/{id}/reprocess`** — re-run detection on an existing session, or split it by hand with `{segments: [[start, end], ...]}` (background job)
- **`POST /api/sessions/{id}/merge`** — merge other recordings of the same band into this one (`{session_ids}`), as a background job: the sources are joined into one file and the existing tracks are moved over with shifted times (no re-detection, no re-export)

Both support `single=true` to skip song detection and import the whole file as one track.

## Data Flow

```
Audio file (.m4a/.wav/.mp3/.flac/.ogg)
  │
  ├─ metadata.py ──→ extract_metadata() ──→ AudioMetadata (date, duration, codec...)
  │
  ├─ splitter.py ──→ detect_songs()
  │     │  ffmpeg decode → 8 kHz mono PCM
  │     │  compute_rms_profile() → per-second dB values
  │     │  smooth_profile() → 9-sec rolling average
  │     │  playing_threshold_db() → level relative to this recording
  │     └─→ SplitResult (list of start/end timestamps)
  │
  ├─ output.py ──→ export_segments()
  │     │  generate_output_name() → date_track_timestamps.m4a
  │     └─ splitter.export_segment() → ffmpeg seek+split → audio file
  │
  ├─ storage.py ──→ put() to R2 (if remote storage configured)
  │
  └─ db.py ──→ create session + track records in SQLite
```

## Processing Parameters

- **single** — skip detection, import entire file as one track (default: false)

There is no level setting. Older clients may still send `threshold` / `min_duration`; both are accepted and ignored.

## Automatic Song Tagging (speech-to-text)

Untagged tracks are tagged automatically when they are recognised: right after an upload and in a nightly run. It runs entirely on the server: no external service. The recording page marks these tracks "auto-tagged"; a wrong one is fixed like any other tag.

1. **Transcribe** (`transcribe.py`) — a Whisper model (`small.en` by default, via faster-whisper, CPU, int8) transcribes each track's vocals. ffmpeg decodes 3-minute chunks so memory stays flat at about 0.8 GB; a track takes roughly 1/6 of its length on one core. The model (~460 MB) is downloaded once into `<JAM_DATA_DIR>/models`. The transcript is rough on purpose: it is only used for matching. It is stored in `track_transcripts`, together with the time of each phrase (`segments`) and the track's loudness per second (`levels`), and redone only when the track's audio file changes (trim, split, merge).
2. **Match** (`song_match.py`) — transcripts and texts are compared as TF-IDF vectors over word 1–3-grams. A track is compared with (a) the lyrics in the charts of its band's songs and (b) the transcripts of its band's takes that a person tagged, which is what recognises originals with no lyrics written down. Takes tagged automatically are not references, so one mistake can't spread.
3. **Refine the split** (`refine.py`) — loudness can't tell a pause inside a song from the pause between two songs played back to back, so a detected split is corrected once from what is sung. Loudness proposes where a cut could go (a dip of 2+ seconds below the track's playing level); the words on either side decide:
   - **Split** a track at a dip when the two sides are different songs: both recognised as different songs, or one recognised and the other 60+ words of singing that clearly isn't that song. Both parts must be 90+ seconds.
   - **Merge** two neighbouring tracks at most 20 seconds apart when both are recognised as the same song, unless the second starts with the same lines as the first (the band started over: a second take).

   Only recordings whose tracks came from detection and haven't been touched since are refined (`sessions.split_state = 'auto'`: no manual split/merge/trim, no track tagged by a person, no track notes), once, when all their tracks are transcribed; then they are `refined`. The new tracks get their transcripts from the old ones, so nothing is transcribed twice. A wrong split is undone with Merge, a wrong merge with Split; neither is redone. Instrumentals and songs the band has no chart or tagged take for stay as detection cut them.
4. **Tag** (`identify.py`) — a track is tagged only when the best song clearly beats the runner-up. Tracks that already have a tag are never touched. Each automatic tag is recorded in `track_auto_tags`; if someone removes it, the same song is not applied to that track again.
5. **When it runs** (`jam-session identify-songs`, a child process started by the server; one at a time, others queue):
   - **After an upload, Drive import or re-split** — for that recording only (`--session ID`): its tracks are transcribed, then every untagged track is re-assessed. A 90-minute recording takes roughly 15 minutes on one core.
   - **Nightly** (`JAM_IDENTIFY_HOUR`, UTC) — transcribes any track without a transcript (newest recordings first, up to `JAM_IDENTIFY_MAX_MINUTES`, the rest the next night), then re-assesses every untagged track, so more get recognised as more takes are tagged by hand and charts gain lyrics. It also catches whatever an after-upload run skipped.
   - **On demand** (superadmin) — `POST /api/admin/song-identification/run` starts a full run like the nightly one; `?session_id=ID` runs it for one recording, so an older recording doesn't wait behind hundreds of newer tracks.

   A run waits up to `JAM_IDENTIFY_WAIT_MINUTES` (30) while another recording is being processed or free memory is below `JAM_TRANSCRIBE_MIN_FREE_MB`, then skips transcribing if that hasn't cleared (recordings uploaded or re-detected together would otherwise lose their run: the first one's starts while the others are still being split). A deploy restarts the server, which kills the run in progress and forgets the queue; 90 seconds after startup the server starts a run again for every detected recording (`split_state = 'auto'`) that still has tracks without a transcript. Transcripts are saved per track, so nothing is redone. `GET /api/sessions/{id}` reports `tagging` (`running`/`queued`, tracks transcribed of total) and the recording page shows it. Tagged tracks are transcribed too: they are the reference takes. `JAM_IDENTIFY_HOUR=off` turns all automatic runs off.

Measured on 174 labeled takes with `small.en`: 103 recognised, of which 99 right; none of the instrumental jams. `base.en` is about 3x faster and needs ~0.5 GB but gets noticeably fewer right.

Without the `transcribe` extra installed (`pip install -e ".[transcribe]"`; the Docker image has it) nothing is transcribed and nothing else changes.
