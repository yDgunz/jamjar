# Processing Pipeline

## Pipeline Steps

1. **Metadata extraction** — reads `.m4a` and `.wav` files using mutagen. Recording date comes from iPhone `©day` tag, then filename parsing (`M-D-YY`, `M-D-YYYY`, `YYYY-MM-DD`).
2. **Song detection** — decodes to 8 kHz mono PCM via ffmpeg, computes per-second RMS energy, applies 15-second rolling average, finds sustained high-energy regions (default: 2+ minutes above -20 dB). Can be skipped with single-song mode, which imports the entire file as one track.
3. **Export** — ffmpeg seek+split extracts each song to AAC (M4A container, 192kbps). No full-file loading.
4. **Storage** — exported tracks are saved locally and optionally uploaded to Cloudflare R2 (when configured).
5. **Database** — creates session and track records in SQLite with relative file paths.

## Trigger Points

Processing runs server-side via two API endpoints:

- **`POST /api/sessions/upload`** — upload a new audio file; runs the full pipeline (metadata → detection → export → DB)
- **`POST /api/sessions/{id}/reprocess`** — re-run detection on an existing session with new threshold/min-duration parameters

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
