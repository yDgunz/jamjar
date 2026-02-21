# Processing Pipeline

## Pipeline Steps

1. **Metadata extraction** — reads `.m4a` and `.wav` files using mutagen. Recording date comes from iPhone `©day` tag, then filename parsing (`M-D-YY`, `M-D-YYYY`, `YYYY-MM-DD`).
2. **Song detection** — decodes to 8 kHz mono PCM via ffmpeg, computes per-second RMS energy, applies 15-second rolling average, finds sustained high-energy regions (default: 2+ minutes above -30 dB).
3. **Export** — ffmpeg seek+split extracts each song to AAC (M4A container, 192kbps). Opus and WAV available via `--format` flag. No full-file loading.
4. **Database** — creates session and track records in SQLite with file paths.

## Data Flow

```
Audio file (.m4a/.wav)
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
  │     │  generate_output_name() → date_track_timestamps[_song].m4a
  │     └─ splitter.export_segment() → ffmpeg seek+split → audio file
  │
  └─ db.py ──→ create session + track records in SQLite
```

## `process` CLI Options

- `-t, --threshold` — energy threshold in dB (default: -30, higher = more selective)
- `-m, --min-duration` — minimum song duration in seconds (default: 120)
- `-o, --output-dir` — output directory (default: `./output/<input_stem>/`)
- `-f, --format` — output audio format: `aac`, `opus`, or `wav` (default: `aac`)
