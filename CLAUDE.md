# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tool for processing and cataloging band jam session recordings. Splits full iPhone recordings into individual songs, stores them in a catalog database, and provides a web UI for reviewing, tagging, and comparing takes across sessions.

## Current Features (CLI — complete)

**Metadata Extraction (`jam-session info <file>`)**
- Reads metadata from `.m4a` and `.wav` files using mutagen
- Displays: filename, duration, file size, codec, sample rate, channels, bitrate, recording date
- Recording date sources (in priority order): iPhone `©day` metadata tag, then parsed from filename
- Filename date parsing supports: `M-D-YY`, `M-D-YYYY`, `YYYY-MM-DD`

**Song Detection & Splitting (`jam-session process <file>`)**
- Uses ffmpeg to decode audio to raw PCM, then computes per-second RMS energy levels
- Applies a 15-second rolling average to smooth out brief spikes/dips
- Identifies sustained high-energy sections as songs (default: 2+ minutes above -30 dB)
- Exports only the detected songs via ffmpeg seek+split (no full-file loading)
- Output filenames include date, track number, and timestamp range: `<date>_<track>_<start>-<end>.wav`

**CLI Options:**
- `-t, --threshold` — energy threshold in dB (default: -30, higher = more selective)
- `-m, --min-duration` — minimum song duration in seconds (default: 120)
- `-o, --output-dir` — output directory (default: `./output/<input_stem>/`)
- `-r, --references` — directory of reference songs for chroma fingerprint matching
- `--match-threshold` — DTW distance threshold for reference matching (default: 0.04)

## Architecture

### Python Backend (`src/jam_session_processor/`)
- **`cli.py`** — click CLI entry points, wires together the processing pipeline
- **`metadata.py`** — `extract_metadata()` returns an `AudioMetadata` dataclass; `parse_date_from_filename()` extracts dates from common filename patterns
- **`splitter.py`** — `compute_rms_profile()` decodes via ffmpeg to 8kHz mono PCM and computes per-second RMS dB; `detect_songs()` smooths the profile and finds sustained high-energy regions; `export_segment()` uses ffmpeg to extract a time range to `.wav`
- **`output.py`** — `generate_output_name()` builds filenames with date, track number, timestamps, and optional song name/fingerprint; `export_segments()` orchestrates exporting with fingerprinting and reference matching
- **`fingerprint.py`** — chroma-based audio fingerprinting using FFT; DTW sequence matching against reference songs; edge trimming to reduce noodling contamination

### Web Frontend (`web/` — planned)
- React + TypeScript + Tailwind CSS, built with Vite
- Communicates with FastAPI backend via JSON API
- Serves audio files for in-browser playback

## Build & Development Commands

```bash
# Activate the venv (Python 3.12 via Homebrew)
source .venv/bin/activate

# Install in development mode
pip install -e ".[dev]"

# Run the CLI
jam-session process <file>
jam-session info <file>

# Run all tests
pytest

# Run a single test
pytest tests/test_splitter.py::test_function_name

# Lint
ruff check src/ tests/

# Format
ruff format src/ tests/
```

## Development Process

- **Always run `pytest` after every code change** to catch regressions early
- Test fixtures generate synthetic audio (sine tones + silence) so tests run fast (~3.5s) with no real audio files needed
- `input/`, `output/`, and `references/` directories are gitignored
- Commit each phase/feature independently

## System Dependencies

- **Python 3.12** — installed via `brew install python@3.12`, venv at `.venv/`
- **FFmpeg** — installed via `brew install ffmpeg`
- **Node.js** — required for the web frontend (Vite + React)

## Design Decisions

- **Output format:** `.wav` (PCM 16-bit)
- **Song detection:** Energy-based, not silence-based. A 15-second smoothing window and minimum duration filter distinguish actual songs from brief noodling between them.
- **Default threshold:** -30 dB with 120s minimum duration. For louder rooms or more noodling, raise the threshold (e.g., -25). For quieter recordings, lower it (e.g., -35).
- **Performance:** ffmpeg handles all decoding and segment export at the C level. A 1.5hr session processes in ~10 seconds.
- **Database:** SQLite — no server, portable, lives in the project directory
- **Backend API:** FastAPI — serves JSON endpoints and static audio files
- **Frontend:** React + TypeScript + Tailwind via Vite — clean separation from backend
- **Song tagging:** Manual via web UI. Auto-matching (chroma fingerprinting) is available but not reliable enough for same-band recordings to be the primary workflow.

## Test Data

- `input/5Biz 2-3-26.m4a` — full 1h38m jam session (iPhone Voice Memo, date: 2026-02-03)
- `input/5biz Good band jams 11-11-25 - good jams at 9_30.m4a` — 54m session (date: 2025-11-11)
- `input/unknown-date_02.wav` — 18-minute excerpt containing ~4 songs, useful for testing detection tuning
- `references/` — 4 reference recordings (Be Forever, Fat Cat, Good God Damn, Spit Me Out)

## Roadmap

### Phase 1: Database & Catalog
- [ ] SQLite schema: `sessions`, `tracks`, `songs` tables
- [ ] Python database module with CRUD operations
- [ ] Wire `jam-session process` into the database (creates session + track records on split)
- [ ] `jam-session sessions` CLI command to list processed sessions

### Phase 2: FastAPI Backend
- [ ] FastAPI app with endpoints for sessions, tracks, songs
- [ ] Serve audio files for streaming playback
- [ ] `jam-session serve` CLI command to start the web server

### Phase 3: Web UI — Session Browser
- [ ] Vite + React + TypeScript + Tailwind project scaffolding in `web/`
- [ ] Sessions list page (date, track count, tagged/untagged counts)
- [ ] Session detail page with track list and HTML5 audio players

### Phase 4: Tagging
- [ ] Song name input per track with autocomplete from existing song catalog
- [ ] Create new songs on the fly when typing a new name
- [ ] Inline save (no page reload)

### Phase 5: Song Catalog & History
- [ ] Song catalog page — all known songs, number of takes, date range
- [ ] Song history page — all takes of a song sorted by date, with players for A/B comparison
- [ ] Notes/annotations on sessions and individual tracks

### Phase 6: Import & Bulk Operations
- [ ] Bulk import from a directory of recordings
- [ ] Spreadsheet import (format TBD) to pre-populate tags and session notes
- [ ] Re-process sessions with different split settings

### Future Ideas
- Auto-suggest song names based on catalog history (fingerprint matching improves with labeled data)
- Duration/energy trends per song over time
- Export playlists or compilations (best takes)
- Multi-user notes (bandmates add their own annotations)
