# Processing Pipeline

## Pipeline Steps

1. **Metadata extraction** — reads `.m4a`, `.wav`, `.mp3`, `.flac`, and `.ogg` files using mutagen. Recording date comes from iPhone `©day` tag, then filename parsing (`M-D-YY`, `M-D-YYYY`, `YYYY-MM-DD`).
2. **Song detection** — decodes to 8 kHz mono PCM via ffmpeg, computes per-second RMS energy, applies 15-second rolling average, finds sustained high-energy regions (default: 2+ minutes above -20 dB). Can be skipped with single-song mode, which imports the entire file as one track.
3. **Export** — ffmpeg seek+split extracts each song to AAC (M4A container, 192kbps). No full-file loading.
4. **Storage** — exported tracks are saved locally and optionally uploaded to Cloudflare R2 (when configured).
5. **Database** — creates session and track records in SQLite with relative file paths.

## Trigger Points

Processing runs server-side via two API endpoints:

- **`POST /api/drive/import`** — import a file from a Google Drive folder shared with the app's service account. The server downloads it with the Drive API into `recordings/drive/<file id>/`, checks for a duplicate by duration (unless `force`), then runs the same processing job as an upload. The Drive file is recorded in `drive_imports` (imported / duplicate / skipped) so it isn't offered again.
- **`POST /api/sessions/upload`** — upload a new audio file; saves the file and returns a job ID (HTTP 202). Processing runs in a background thread. The frontend polls `GET /api/jobs/{id}` for real-time progress updates until the job completes or fails. When R2 storage is configured, local files are cleaned up after successful upload.
- **`POST /api/sessions/{id}/reprocess`** — re-run detection on an existing session with new threshold/min-duration parameters (synchronous)
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
  │     │  smooth_profile() → 15-sec rolling average
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

- **threshold** — energy threshold in dB (default: -20, higher = more selective)
- **min_duration** — minimum song duration in seconds (default: 120)
- **single** — skip detection, import entire file as one track (default: false)

## Automatic Song Tagging (speech-to-text)

A nightly run tags untagged tracks it recognises. It runs entirely on the server: no external service. The recording page marks these tracks "auto-tagged"; a wrong one is fixed like any other tag.

1. **Transcribe** (`transcribe.py`) — a Whisper model (`small.en` by default, via faster-whisper, CPU, int8) transcribes each track's vocals. ffmpeg decodes 3-minute chunks so memory stays flat at about 0.8 GB; a track takes roughly 1/6 of its length on one core. The model (~460 MB) is downloaded once into `<JAM_DATA_DIR>/models`. The transcript is rough on purpose: it is only used for matching. It is stored in `track_transcripts` and redone only when the track's audio file changes (trim, split, merge).
2. **Match** (`song_match.py`) — transcripts and texts are compared as TF-IDF vectors over word 1–3-grams. A track is compared with (a) the lyrics in the charts of its band's songs and (b) the transcripts of its band's takes that a person tagged, which is what recognises originals with no lyrics written down. Takes tagged automatically are not references, so one mistake can't spread.
3. **Tag** (`identify.py`) — a track is tagged only when the best song clearly beats the runner-up. Tracks that already have a tag are never touched. Each automatic tag is recorded in `track_auto_tags`; if someone removes it, the same song is not applied to that track again.
4. **Nightly run** (`jam-session identify-songs`) — once a day (`JAM_IDENTIFY_HOUR`, UTC) the server starts the run in a child process: it transcribes tracks without a transcript (newest recordings first, up to `JAM_IDENTIFY_MAX_MINUTES`, the rest the next night), then re-assesses **every** untagged track, so more get recognised as more takes are tagged by hand and charts gain lyrics. The run skips transcribing when free memory is below `JAM_TRANSCRIBE_MIN_FREE_MB` or a recording is being processed. Tagged tracks are transcribed too: they are the reference takes.

Measured on 174 labeled takes with `small.en`: 103 recognised, of which 99 right; none of the instrumental jams. `base.en` is about 3x faster and needs ~0.5 GB but gets noticeably fewer right.

Without the `transcribe` extra installed (`pip install -e ".[transcribe]"`; the Docker image has it) nothing is transcribed and nothing else changes.
