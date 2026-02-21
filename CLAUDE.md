# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tool for processing and cataloging band jam session recordings. Splits full iPhone recordings into individual songs, stores them in a catalog database, and provides a web UI for reviewing, tagging, and comparing takes across sessions.

## Architecture

### System Layers

```
Web Frontend (React + TypeScript + Tailwind) → localhost:5173
REST API (FastAPI) → localhost:8000
Database (SQLite) → jam_sessions.db
Processing Pipeline (Python) → metadata → detection → export
Audio Engine (FFmpeg) → decoding, conversion, extraction
```

### Python Modules (`src/jam_session_processor/`)

| Module | Responsibility |
|--------|---------------|
| `config.py` | Environment-based config singleton (`get_config()`), path resolution |
| `cli.py` | Click CLI entry points, wires together the full pipeline |
| `metadata.py` | `AudioMetadata` dataclass, `extract_metadata()`, `parse_date_from_filename()` |
| `splitter.py` | `compute_rms_profile()`, `smooth_profile()`, `detect_songs()`, `export_segment()` |
| `output.py` | Output filename generation, segment export orchestration |
| `db.py` | SQLite schema, `Database` class with session/track/song CRUD |
| `track_ops.py` | Merge/split track operations: re-export, renumber |
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
                           audio_path                  │
                           notes                       │
                           created_at                  │
```

- `sessions → tracks`: one-to-many, CASCADE delete
- `tracks → songs`: many-to-one (nullable), SET NULL on delete
- Songs are created on first tag and reused across sessions

### REST API

**Sessions:** `GET /api/sessions` | `GET /api/sessions/{id}` | `GET /api/sessions/{id}/tracks`
**Tracks:** `POST /api/tracks/{id}/tag` | `DELETE /api/tracks/{id}/tag` | `PUT /api/tracks/{id}/notes` | `GET /api/tracks/{id}/audio` | `POST /api/tracks/{id}/merge` | `POST /api/tracks/{id}/split`
**Songs:** `GET /api/songs` | `GET /api/songs/{id}/tracks`

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
- Commit each phase/feature independently

## System Dependencies

- **Python 3.12** — installed via `brew install python@3.12`, venv at `.venv/`
- **FFmpeg** — installed via `brew install ffmpeg`
- **Node.js** — required for the web frontend (Vite + React)

## Deployment

The app runs in Docker via `docker compose`. CI/CD is via GitHub Actions (`.github/workflows/deploy.yml`): push to `main` triggers SSH deploy to the VPS.

**Required GitHub Secrets:** `SSH_HOST`, `SSH_USER`, `SSH_KEY`

**SQLite backups:** `scripts/backup-db.sh` uses `sqlite3 .backup` for safe copies. Add a cron job in the container or host to run it periodically.

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
| `JAM_MAX_UPLOAD_MB` | `500` | Maximum upload file size in MB |

Path values stored in the DB are relative to `JAM_DATA_DIR`. The `config.resolve_path()` method resolves them to absolute at runtime. Already-absolute paths (from old DBs) pass through unchanged.

## Design Decisions

- **Output format:** AAC in M4A container at 192kbps (default). Opus and WAV available via `-f/--format` CLI option. AAC was chosen over Opus for Safari/iOS compatibility.
- **Song detection:** Energy-based, not silence-based. A 15-second smoothing window and minimum duration filter distinguish actual songs from brief noodling between them.
- **Default threshold:** -30 dB with 120s minimum duration. For louder rooms or more noodling, raise the threshold (e.g., -25). For quieter recordings, lower it (e.g., -35).
- **Performance:** ffmpeg handles all decoding and segment export at the C level. A 1.5hr session processes in ~10 seconds.
- **Database:** SQLite — no server, portable, lives in the project directory
- **Backend API:** FastAPI — serves JSON endpoints and static audio files
- **Frontend:** React + TypeScript + Tailwind via Vite — clean separation from backend
- **Song tagging:** Manual via web UI.

## Detailed Documentation

- [`docs/pipeline.md`](docs/pipeline.md) — processing pipeline data flow and CLI options
- [`docs/test-coverage.md`](docs/test-coverage.md) — backend and frontend coverage maps, test data
- [`docs/roadmap.md`](docs/roadmap.md) — current, next, and future work items
