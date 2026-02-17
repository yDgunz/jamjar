# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tool for processing and cataloging band jam session recordings. Splits full iPhone recordings into individual songs, stores them in a catalog database, and provides a web UI for reviewing, tagging, and comparing takes across sessions.

## Current Features

### CLI Commands

| Command | Description |
|---------|-------------|
| `jam-session info <file>` | Display metadata (duration, codec, sample rate, recording date) |
| `jam-session process <file>` | Detect songs, split, fingerprint, export, and save to database |
| `jam-session process-all <dir>` | Batch process all audio files in a directory |
| `jam-session sessions` | List all processed sessions with track/tag counts |
| `jam-session tracks <session_id>` | List tracks for a session with timestamps and tags |
| `jam-session reset-db` | Clear all data from the database (with confirmation) |
| `jam-session serve` | Start the FastAPI backend (default port 8000) |

### Processing Pipeline

1. **Metadata extraction** — reads `.m4a` and `.wav` files using mutagen. Recording date comes from iPhone `©day` tag, then filename parsing (`M-D-YY`, `M-D-YYYY`, `YYYY-MM-DD`).
2. **Song detection** — decodes to 8 kHz mono PCM via ffmpeg, computes per-second RMS energy, applies 15-second rolling average, finds sustained high-energy regions (default: 2+ minutes above -30 dB).
3. **Fingerprinting** — computes chroma-based fingerprint (FFT → pitch class binning → 32-bin summary → SHA256 hash). Optionally matches against reference songs using DTW distance.
4. **Export** — ffmpeg seek+split extracts each song to Opus (OGG container, 192kbps). WAV and AAC available via `--format` flag. No full-file loading.
5. **Database** — creates session and track records in SQLite with fingerprints and file paths.

### `process` CLI Options

- `-t, --threshold` — energy threshold in dB (default: -30, higher = more selective)
- `-m, --min-duration` — minimum song duration in seconds (default: 120)
- `-o, --output-dir` — output directory (default: `./output/<input_stem>/`)
- `-r, --references` — directory of reference songs for chroma fingerprint matching
- `--match-threshold` — DTW distance threshold for reference matching (default: 0.04)
- `-f, --format` — output audio format: `opus`, `aac`, or `wav` (default: `opus`)

### REST API

FastAPI backend serving JSON endpoints and audio streaming:

**Sessions:** `GET /api/sessions` | `GET /api/sessions/{id}` | `GET /api/sessions/{id}/tracks`
**Tracks:** `POST /api/tracks/{id}/tag` | `DELETE /api/tracks/{id}/tag` | `PUT /api/tracks/{id}/notes` | `GET /api/tracks/{id}/audio` | `POST /api/tracks/{id}/merge` | `POST /api/tracks/{id}/split`
**Songs:** `GET /api/songs` | `GET /api/songs/{id}/tracks`

### Web Frontend (in progress)

React + TypeScript + Tailwind CSS (Vite). Session list, session detail with track playback, inline song tagging.

## Architecture

### System Layers

```
┌─────────────────────────────────────────────────────────┐
│  Web Frontend (React + TypeScript + Tailwind)           │
│  localhost:5173 — sessions list, track playback, tagging│
├─────────────────────────────────────────────────────────┤
│  REST API (FastAPI)                                     │
│  localhost:8000 — JSON endpoints + audio streaming      │
├─────────────────────────────────────────────────────────┤
│  Database (SQLite)                                      │
│  jam_sessions.db — sessions, tracks, songs              │
├─────────────────────────────────────────────────────────┤
│  Processing Pipeline (Python)                           │
│  metadata → song detection → fingerprinting → export    │
├─────────────────────────────────────────────────────────┤
│  Audio Engine (FFmpeg)                                  │
│  Decoding, format conversion, segment extraction        │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

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
  ├─ fingerprint.py ──→ for each segment:
  │     │  ffmpeg decode → 11 kHz mono float32
  │     │  _compute_chromagram() → (frames, 12) array
  │     │  _trim_edges() → remove first/last 10%
  │     │  _summarize_chromagram() → (32, 12) fixed-size summary
  │     ├─→ compute_chroma_fingerprint() → 16-char hex hash
  │     └─→ match_against_references() → DTW distance match (optional)
  │
  ├─ output.py ──→ export_segments()
  │     │  generate_output_name() → date_track_timestamps[_song].wav
  │     └─ splitter.export_segment() → ffmpeg seek+split → WAV file
  │
  └─ db.py ──→ create session + track records in SQLite
```

### Python Modules (`src/jam_session_processor/`)

| Module | Responsibility |
|--------|---------------|
| `config.py` | Environment-based config singleton (`get_config()`), path resolution |
| `cli.py` | Click CLI entry points, wires together the full pipeline |
| `metadata.py` | `AudioMetadata` dataclass, `extract_metadata()`, `parse_date_from_filename()` |
| `splitter.py` | `compute_rms_profile()`, `smooth_profile()`, `detect_songs()`, `export_segment()` |
| `fingerprint.py` | Chroma FFT analysis, DTW matching, fingerprint hashing, reference DB |
| `output.py` | Output filename generation, segment export orchestration |
| `db.py` | SQLite schema, `Database` class with session/track/song CRUD |
| `track_ops.py` | Merge/split track operations: re-export, fingerprint, renumber |
| `api.py` | FastAPI app, Pydantic models, REST endpoints, audio streaming |

### Database Schema

```
sessions                    tracks                        songs
────────────────           ─────────────────────          ──────────────
id (PK)                    id (PK)                        id (PK)
date                       session_id (FK→sessions) ──┐   name (UNIQUE)
source_file                song_id (FK→songs) ────────┤   created_at
notes                      track_number               │
created_at                 start_sec, end_sec          │
                           duration_sec                │
                           fingerprint                 │
                           audio_path                  │
                           notes                       │
                           created_at                  │
```

- `sessions → tracks`: one-to-many, CASCADE delete
- `tracks → songs`: many-to-one (nullable), SET NULL on delete
- Songs are created on first tag and reused across sessions

### Frontend (`web/`)

- `src/api.ts` — typed fetch wrapper for all API endpoints
- `src/App.tsx` — React Router with nav: Sessions, Songs
- `src/pages/SessionList.tsx` — fetches and displays all sessions
- `src/pages/SessionDetail.tsx` — session metadata + track list
- `src/pages/SongCatalog.tsx` — all tagged songs with take counts and date ranges
- `src/pages/SongHistory.tsx` — all takes of a song with audio players for A/B comparison
- `src/components/TrackRow.tsx` — audio playback, song tagging UI, inline editing

## Technical Concepts (Audio/DSP)

This section explains the signal processing techniques used in the project and why they were chosen.

### RMS Energy and Decibels

**What RMS measures.** RMS (Root Mean Square) computes the effective average power of an audio signal. Unlike peak amplitude (the single loudest sample), RMS reflects the perceived loudness over a window of time. For a window of N samples, RMS = sqrt(mean(sample^2)). A loud song and a brief drum hit might have the same peak, but the song has much higher RMS because the energy is sustained.

**Why decibels.** Human hearing is logarithmic — a sound must be about 10x more powerful to seem "twice as loud." The dB scale matches this by converting linear power to logarithmic: `dB = 10 * log10(power / reference)`. In this project, the reference is full-scale 16-bit audio (32768^2), so 0 dB = maximum possible level and silence approaches -100 dB. The default threshold of -30 dB works because songs in a jam session have significantly more sustained energy than the gaps between them.

**Why 8 kHz mono.** Song detection only needs to measure overall energy levels, not reconstruct the audio. Downsampling from 44.1 kHz stereo to 8 kHz mono is ~11x less data. This is the same sample rate used by telephone audio — more than enough to capture whether the band is playing or not. The actual export uses ffmpeg on the original file at full quality.

*See: `splitter.py:20-46` — `compute_rms_profile()`*

### Rolling Average Smoothing

**The problem.** Raw per-second RMS values are noisy. A brief pause between verses, a loud cymbal crash during a break, or someone dropping a pick can cause the energy to dip below or spike above the threshold for a few seconds. Without smoothing, you'd get fragmented detections — one song split into three pieces, or noise between songs counted as music.

**How it works.** A 15-second centered rolling average replaces each second's dB value with the mean of the surrounding ±7 seconds. This acts as a low-pass filter on the energy signal: short events (< 15 sec) get averaged away, while sustained level changes (a song starting or ending) pass through. The math is simple — just a sliding window mean.

**Trade-offs.** A wider window (e.g., 30 sec) would be even smoother but would blur the exact start/end of songs, losing precision at boundaries. The 15-second window is a practical middle ground: it tolerates brief pauses within a song while still responding to actual transitions. The 2-second padding added to detected boundaries compensates for any boundary imprecision.

*See: `splitter.py:49-59` — `smooth_profile()`*

### FFT (Fast Fourier Transform)

**Time domain vs. frequency domain.** A raw audio signal is a sequence of amplitude values over time — you can see *when* things happen but not *what notes* are playing. The FFT converts a window of samples into a frequency spectrum: the amplitude at each frequency present in that window. This is the foundation of all pitch-based analysis.

**Parameters in this project.** With `N_FFT=8192` samples at 11,025 Hz sample rate, each FFT window covers ~0.74 seconds of audio. The frequency resolution is `sample_rate / N_FFT` = ~1.35 Hz, which is fine enough to distinguish adjacent musical notes (the smallest interval in the chromatic scale is ~15 Hz in the bass range). A Hanning window is applied before the FFT to reduce spectral leakage — without windowing, the abrupt edges of the sample chunk create phantom frequencies.

**Power spectrum.** The FFT returns complex numbers (magnitude + phase). This project uses the power spectrum (`|FFT|^2`), discarding phase information. Phase tells you *where* in the waveform cycle you sampled — irrelevant for identifying what notes are playing.

*See: `fingerprint.py:35-64` — `_compute_chromagram()`*

### Chroma Features

**Octave equivalence.** In Western music, a C note is a C whether it's C2 (65 Hz), C3 (131 Hz), or C5 (523 Hz). Chroma features exploit this by folding all frequencies into 12 bins — one per pitch class (C, C#, D, D#, E, F, F#, G, G#, A, A#, B). The mapping uses `chroma_bin = round(12 * log2(freq / 440)) mod 12`, which computes each frequency's distance from A4 in semitones, then wraps into 0-11.

**Why chroma works for song identification.** A chroma frame captures the chord being played at that moment — a C major chord lights up C, E, and G bins regardless of octave or instrument. A sequence of chroma frames captures the chord progression, which is the most identifying characteristic of a song. Two performances of the same song by the same band will follow roughly the same chord progression even if the tempo, key, or arrangement differs slightly.

**Frame normalization.** Each chroma frame is normalized to unit length (L2 norm). This makes the representation invariant to volume — a quietly strummed Am chord and a loudly strummed Am chord produce the same normalized chroma vector. Only the *distribution* across pitch classes matters.

**Frequency range.** The code only maps frequencies between 60-4200 Hz to chroma bins. Below 60 Hz is sub-bass rumble and room noise. Above 4200 Hz is harmonics and cymbal wash that don't contribute useful pitch information.

*See: `fingerprint.py:35-64` — `_compute_chromagram()`, specifically the `chroma_map` construction*

### Dynamic Time Warping (DTW)

**The problem.** Two performances of the same song are never exactly the same length. The band might play the intro longer, speed up during the chorus, or add an extra bar. A simple frame-by-frame comparison would fail because frame 100 in one version might correspond to frame 110 in another.

**How DTW works.** DTW finds the optimal alignment between two sequences by "warping" time. It builds a cost matrix where `cost[i][j]` is the distance between frame i of song A and frame j of song B (using cosine distance on the chroma vectors). Then it fills a DP (dynamic programming) matrix where each cell is the minimum cumulative cost to reach that alignment, choosing at each step to advance in A, advance in B, or advance in both. The final cell gives the total cost of the best alignment.

**Cosine distance.** The frame-level cost is `1 - cosine_similarity`, where cosine similarity measures the angle between two chroma vectors. Two identical chords have cosine distance 0. Two completely different chords approach distance 1. This is better than Euclidean distance for normalized vectors because it focuses purely on direction (chord shape) rather than magnitude.

**Normalization.** The raw DTW distance grows with sequence length, so it's divided by `(n + m)` to get a length-independent similarity measure. The default threshold of 0.04 is conservative — it means the average frame-to-frame cost along the optimal alignment path is less than 4% of maximum dissimilarity.

**Why DTW isn't the primary matching method.** For same-band recordings, DTW often can't distinguish songs because the band's harmonic style is consistent across songs — similar chords, similar keys, similar energy. It works better for matching against *reference recordings* of known songs, where the comparison is between a jam take and a clean studio version.

*See: `fingerprint.py:144-173` — `_dtw_distance()`*

### Edge Trimming

**The problem.** When a jam session recording is split by energy levels, the first and last few seconds of each detected segment often contain noodling, tuning, feedback, or talking — not the actual song. This contaminates the fingerprint because those frames have essentially random chroma content.

**The solution.** Trim the first and last 10% of frames before fingerprinting. For a 4-minute song (~480 chroma frames), this removes ~24 seconds from each end. The remaining 80% captures the core chord progression. This simple heuristic significantly improves fingerprint consistency across takes of the same song.

*See: `fingerprint.py:67-73` — `_trim_edges()`*

### Fingerprint Hashing vs. DTW Matching

The project uses two different approaches for song identification, each suited to a different use case:

**Fingerprint hash** (`compute_chroma_fingerprint`): Summarizes the trimmed chromagram into a fixed 32x12 grid, quantizes values to 2 decimal places, and SHA256 hashes the result into a 16-character hex string. This is a compact equality check — if two songs produce the same hash, they're very likely the same performance (or two very similar performances). Fast to compute and store, but binary: either it matches or it doesn't.

**DTW matching** (`match_against_references`): Computes the actual similarity between two chord progressions on a continuous scale. More expensive (O(n*m) DP), but it can measure *how similar* two performances are rather than just equal-or-not. Used for matching a new recording against a library of known reference songs.

**In practice**, neither is reliable enough for fully automatic tagging of same-band recordings — the band's harmonic vocabulary is too consistent across different songs. The primary workflow is manual tagging through the web UI, with fingerprinting as a supplemental signal.

*See: `fingerprint.py:117-134` — hashing; `fingerprint.py:196-221` — reference matching*

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

# Start the backend API server
jam-session serve

# Start the frontend dev server
cd web && npm run dev
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

## Environment Variables

All configuration is via `JAM_*` environment variables. Defaults match pre-config behavior — nothing breaks without a `.env` file.

| Variable | Default | Description |
|----------|---------|-------------|
| `JAM_DATA_DIR` | `.` (cwd) | Root for input/, output/, jam_sessions.db |
| `JAM_DB_PATH` | `jam_sessions.db` | SQLite path (relative to DATA_DIR or absolute) |
| `JAM_INPUT_DIR` | `input` | Upload destination (relative to DATA_DIR or absolute) |
| `JAM_OUTPUT_DIR` | `output` | Exported tracks base dir (relative to DATA_DIR or absolute) |
| `JAM_CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed origins |
| `JAM_PORT` | `8000` | API server port |

Path values stored in the DB are relative to `JAM_DATA_DIR`. The `config.resolve_path()` method resolves them to absolute at runtime. Already-absolute paths (from old DBs) pass through unchanged.

## Design Decisions

- **Output format:** Opus in OGG container at 192kbps (default). WAV and AAC available via `-f/--format` CLI option.
- **Song detection:** Energy-based, not silence-based. A 15-second smoothing window and minimum duration filter distinguish actual songs from brief noodling between them.
- **Default threshold:** -30 dB with 120s minimum duration. For louder rooms or more noodling, raise the threshold (e.g., -25). For quieter recordings, lower it (e.g., -35).
- **Performance:** ffmpeg handles all decoding and segment export at the C level. A 1.5hr session processes in ~10 seconds.
- **Database:** SQLite — no server, portable, lives in the project directory
- **Backend API:** FastAPI — serves JSON endpoints and static audio files
- **Frontend:** React + TypeScript + Tailwind via Vite — clean separation from backend
- **Song tagging:** Manual via web UI. Auto-matching (chroma fingerprinting) is available but not reliable enough for same-band recordings to be the primary workflow.

## Test Coverage

### Current State

Backend tests live in `tests/` and run via `pytest`. Frontend has **no tests and no test framework**.

### Backend Coverage Map

| Module | Test File | Coverage |
|--------|-----------|----------|
| `api.py` | `test_api.py` | Good — but missing `PUT /sessions/{id}/name`, `PUT /sessions/{id}/date`, `GET /sessions/{id}/audio`; no error-path tests |
| `db.py` | `test_db.py` | Good — but missing `_migrate()` backfill logic, schema creation, PRAGMA settings |
| `track_ops.py` | `test_track_ops.py` | Good — core merge/split covered |
| `fingerprint.py` | `test_fingerprint.py` | Partial — public API tested but no direct tests for `_compute_chromagram()`, `_dtw_distance()`, `_trim_edges()`, ffmpeg decode failures |
| `output.py` | `test_output.py` | Partial — filename generation tested, `export_segments()` only checks file existence (no progress callback, error handling, or format tests) |
| `metadata.py` | `test_metadata.py` | Partial — date parsing tested but no M4A tag extraction, no `©day` fallback chain, no file-mtime fallback |
| `splitter.py` | `test_splitter.py` | Minimal (32 lines) — 3 happy-path `detect_songs()` tests only; `compute_rms_profile()`, `smooth_profile()`, `export_segment()` untested |
| `cli.py` | **none** | **0% — all commands untested** |
| `config.py` | **none** | **0% — path resolution, env var parsing, singleton untested** |

### Frontend Coverage Map

No test framework installed. No test files exist. All 2,100+ lines are untested.

| File | Lines | Untested Logic |
|------|-------|----------------|
| `SongHistory.tsx` | 426 | Chart parsing, bass tab rendering (chord-to-fret mapping), metadata editing |
| `SessionDetail.tsx` | 407 | Reprocess panel, editable fields, delete with file cleanup, track merge flow |
| `TrackRow.tsx` | 251 | Song autocomplete/tagging, split at playback time, notes editing |
| `AudioPlayer.tsx` | 207 | Keyboard shortcuts, global player coordination, seek/skip, markers |
| `api.ts` | 185 | `fetchJson` error extraction, `formatDate`, 20+ typed API methods |
| `SessionList.tsx` | 155 | Month grouping, name/song filtering, file upload |
| `Modal.tsx` | 103 | Escape key handling, danger variant, toast auto-dismiss |
| `SongCatalog.tsx` | 92 | 3-way sorting (name, last played, takes) |

## Test Data

- `input/` — 40 recordings spanning 2021-10 through 2026-02, various lineup combos
- `references/` — 4 reference recordings (Be Forever, Fat Cat, Good God Damn, Spit Me Out)

## Roadmap

### Now — MVP Deployment (you: accounts & infra, Claude: code)

**You do these while Claude works on the code tasks:**
1. Create a **GitHub repo** and push this codebase (Claude needs the remote for deploy later)
2. Sign up for **Hetzner Cloud** (hetzner.com/cloud) — create a CX22 server (2 vCPU, 4GB, ~$4/mo), Ubuntu 24.04, add your SSH key
3. Sign up for **Cloudflare** (free tier) — add your domain, point an A record at the Hetzner IP
4. SSH into the VPS and install Docker: `curl -fsSL https://get.docker.com | sh`

**Claude builds these in parallel:**
- [x] `GET /health` endpoint
- [x] FastAPI serves built frontend as static files (no separate web server in dev)
- [x] Dockerfile (Python + Node build stage, single image, ffmpeg included)
- [x] Caddy reverse proxy config (HTTPS via Let's Encrypt, ~5 lines)
- [x] `docker-compose.yml` (app + Caddy, volume for `JAM_DATA_DIR`)
- [ ] Deploy script or README with push-to-server instructions

### Next — Post-Deploy Hardening

- [ ] CI/CD pipeline: push to main → build Docker image → deploy to VPS
- [ ] SQLite backup strategy (scheduled copies off-site)
- [ ] File size limits on upload endpoint
- [ ] Strip `source_file` and local paths from API responses
- [ ] Global error boundaries in frontend
- [ ] Loading/skeleton states for slow connections

### Later

- Auth & multi-tenancy (users, JWT/cookies, login UI)
- Groups (scoped sessions/songs per band)
- R2 audio storage (presigned URLs, CDN caching)
- Background job processing (async upload/reprocess, progress tracking)
- CLI as API client (`jam-session upload`, `--server` flag)
- Database migrations (Alembic, evaluate Postgres)
- Performance mode enhancements (auto-scroll, transposition, setlists)
- Frontend resilience (TanStack Query, optimistic updates)
- Observability (structured logging, Sentry, usage metrics)
- Security hardening (rate limiting, CSRF, input length limits)
- Data export (CSV/JSON catalog, zip downloads)
- Import & bulk ops (spreadsheet import, batch re-encode)
- Auto-suggest song names, duration/energy trends, playlists, multi-user notes
