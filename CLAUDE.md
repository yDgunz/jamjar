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
| `cli.py` | Click CLI: `serve`, `upload`, user/group admin commands |
| `auth.py` | Password hashing (bcrypt), JWT creation/verification |
| `metadata.py` | `AudioMetadata` dataclass, `extract_metadata()`, `parse_date_from_filename()` |
| `splitter.py` | `compute_rms_profile()`, `smooth_profile()`, `detect_songs()`, `export_segment()` |
| `output.py` | Output filename generation, segment export orchestration |
| `db.py` | SQLite schema, `Database` class with user/group/session/track/song CRUD |
| `track_ops.py` | Merge/split track operations: re-export, renumber |
| `storage.py` | Storage abstraction: `LocalStorage` (filesystem) and `R2Storage` (Cloudflare R2) |
| `api.py` | FastAPI app, auth middleware, Pydantic models, REST endpoints, audio streaming |

### Database Schema

```
users                      groups                     user_groups
──────────────            ──────────────             ─────────────────
id (PK)                   id (PK)                    user_id (FK→users)
email (UNIQUE)            name (UNIQUE)              group_id (FK→groups)
name                      created_at                 PRIMARY KEY (user_id, group_id)
role
password_hash
created_at

sessions                    tracks                        songs
────────────────           ─────────────────────          ──────────────
id (PK)                    id (PK)                        id (PK)
group_id (FK→groups)       session_id (FK→sessions)       group_id (FK→groups)
name                       song_id (FK→songs)             name
date                       track_number                   sheet, notes
source_file                start_sec, end_sec             created_at
notes                      duration_sec                   UNIQUE(group_id, name)
created_at                 audio_path, notes
                           created_at

jobs                           setlists                       setlist_songs
──────────────                ──────────────                 ─────────────────
id (PK, TEXT)                 id (PK)                        id (PK)
type                          group_id (FK→groups)           setlist_id (FK→setlists)
group_id (FK→groups)          name                           song_id (FK→songs)
status (pending→…)            date                           position
progress                      notes                          UNIQUE(setlist_id, position)
session_id (nullable)         created_at
error                         UNIQUE(group_id, name)
created_at, updated_at
```

- **Multi-tenancy:** groups own sessions, songs, and setlists; users belong to groups via `user_groups`
- **Roles:** `superadmin`, `admin`, `editor`, `readonly` — enforced in API middleware
- `groups → sessions/songs/jobs/setlists`: one-to-many, CASCADE delete
- `sessions → tracks`: one-to-many, CASCADE delete
- `tracks → songs`: many-to-one (nullable), SET NULL on delete
- `jobs → sessions`: many-to-one (nullable), SET NULL on delete
- `setlists → setlist_songs`: one-to-many, CASCADE delete
- `setlist_songs → songs`: many-to-one, CASCADE on delete
- Songs are created on first tag and reused across sessions within a group
- Setlists are group-scoped ordered collections of songs, independent of sessions

### REST API

All `/api` endpoints require authentication (JWT cookie or API key header). Role requirements noted in parentheses.

**Auth:** `POST /api/auth/login` | `POST /api/auth/logout` | `GET /api/auth/me`
**Sessions:** `GET /api/sessions` | `GET /api/sessions/{id}` | `GET /api/sessions/{id}/tracks` | `GET /api/sessions/{id}/audio` | `PUT /api/sessions/{id}/name` | `PUT /api/sessions/{id}/notes` | `PUT /api/sessions/{id}/date` | `PUT /api/sessions/{id}/group` (admin) | `DELETE /api/sessions/{id}` (admin) | `POST /api/sessions/{id}/reprocess` (admin) | `POST /api/sessions/upload/init` (admin, returns presigned URL + job) | `POST /api/sessions/upload/complete` (admin, starts processing after R2 upload) | `POST /api/sessions/upload` (admin, direct multipart fallback, returns 202 + job)
**Jobs:** `GET /api/jobs/{id}` — poll for upload progress (status: pending → processing → completed/failed)
**Tracks:** `POST /api/tracks/{id}/tag` | `DELETE /api/tracks/{id}/tag` | `PUT /api/tracks/{id}/notes` | `GET /api/tracks/{id}/audio` | `POST /api/tracks/{id}/merge` (admin) | `POST /api/tracks/{id}/split` (admin)
**Songs:** `GET /api/songs` | `GET /api/songs/{id}` | `GET /api/songs/{id}/tracks` | `PUT /api/songs/{id}/details` | `PUT /api/songs/{id}/name` | `PUT /api/songs/{id}/group` (admin) | `DELETE /api/songs/{id}` (admin)
**Setlists:** `GET /api/setlists` | `POST /api/setlists` (editor) | `GET /api/setlists/{id}` | `GET /api/setlists/{id}/songs` | `PUT /api/setlists/{id}/name` (editor) | `PUT /api/setlists/{id}/date` (editor) | `PUT /api/setlists/{id}/notes` (editor) | `PUT /api/setlists/{id}/songs` (editor, replace order) | `POST /api/setlists/{id}/songs` (editor, add song) | `DELETE /api/setlists/{id}/songs/{position}` (editor) | `DELETE /api/setlists/{id}` (admin)
**Admin:** `GET/POST /api/admin/users` | `DELETE /api/admin/users/{id}` | `PUT .../password` | `PUT .../role` | `POST/DELETE .../groups/{id}` | `GET/POST /api/admin/groups` | `DELETE /api/admin/groups/{id}` (all superadmin)
**Health:** `GET /health`

## Build & Development Commands

```bash
# Activate the venv (Python 3.12 via Homebrew)
source .venv/bin/activate

# Install in development mode
pip install -e ".[dev]"

# Run the CLI
jam-session serve                          # start API server
jam-session upload <file> -s URL -g GROUP  # upload to remote server
jam-session add-user EMAIL                 # create user (prompts for password)
jam-session add-group NAME                 # create group
jam-session assign-user EMAIL GROUP        # add user to group
jam-session list-users / list-groups       # list entities
jam-session reset-password EMAIL           # change password
jam-session set-role EMAIL ROLE            # change user role
jam-session reset-db                       # wipe all data (with confirmation)

# Nuke DB + files, re-seed test data, and restart the server
./scripts/nuke-and-restart.sh

# Seed the database with test data only (no restart)
python scripts/seed-db.py

# Run all tests
pytest

# Run a single test
pytest tests/test_splitter.py::test_function_name

# Lint
ruff check src/ tests/

# Format
ruff format src/ tests/

# Start the frontend dev server
cd web && npm run dev
```

## Development Process

- **Always run `pytest` after every code change** to catch regressions early
- **Always run `ruff check src/ tests/`** before committing to catch lint errors
- Test fixtures generate synthetic audio (sine tones + silence) so tests run fast with no real audio files needed
- Commit each phase/feature independently
- **Keep docs up to date** — when changing behavior (new/modified endpoints, CLI commands, env vars, schema changes, defaults), update `CLAUDE.md` and `docs/pipeline.md` in the same commit

### UI Refinement Workflow

When making UI/CSS changes, follow this workflow for **each** change:

1. Read the current component code
2. Make the CSS/JSX change (prefer minimal CSS changes over restructuring HTML)
3. Run `npx playwright screenshot http://localhost:5173/[path] /tmp/screenshot.png --color-scheme dark` to capture the result (note: authenticated pages will show the login screen unless `--load-storage` is used with a saved auth state)
4. Verify the build compiles with no errors (`cd web && npx tsc --noEmit`)
5. If positioning/layout change, check computed styles for mobile (375px) and desktop (1280px) viewports

Rules:
- Commit each logical change separately with descriptive messages
- If a change requires more than 3 files, stop and explain why before proceeding

### Key patterns for working in this codebase

- **Config/storage singletons:** `get_config()` and `get_storage()` are module-level singletons. In tests, call `reset_config()` and `reset_storage()` (via `monkeypatch` env vars) to reinitialize.
- **Auth in tests:** API tests need `JAM_JWT_SECRET` set. Use the `auth_client` fixture pattern from `test_api.py`: create a user/group, log in via `/api/auth/login`, and the cookie is set on the test client.
- **Group scoping:** Almost all data is scoped to a group. When adding endpoints or DB queries, ensure they filter by the user's `group_ids`. Use `_require_group_access()` in API endpoints.
- **Storage abstraction:** Never read/write audio files directly with `Path` in API code. Use `get_storage()` so the code works with both local files and R2. The `storage.put()/get()/delete()` methods handle both backends.
- **Relative paths in DB:** Audio paths stored in the DB are relative to `JAM_DATA_DIR`. Use `config.make_relative()` when storing and `config.resolve_path()` when reading.

## System Dependencies

- **Python 3.12** — installed via `brew install python@3.12`, venv at `.venv/`
- **FFmpeg** — installed via `brew install ffmpeg`
- **Node.js** — required for the web frontend (Vite + React)

## Deployment

The app runs in Docker via `docker compose`. CI/CD is via GitHub Actions (`.github/workflows/deploy.yml`): push to `main` triggers SSH deploy to the VPS.

**Required GitHub Secrets:** `SSH_HOST`, `SSH_USER`, `SSH_KEY`, `SSH_PASSPHRASE`

**SQLite backups:** `scripts/backup-db.sh` uses `sqlite3 .backup` for safe copies. Add a cron job in the container or host to run it periodically.

## Environment Variables

All configuration is via `JAM_*` environment variables. Defaults match pre-config behavior — nothing breaks without a `.env` file.

| Variable | Default | Description |
|----------|---------|-------------|
| `JAM_DATA_DIR` | `.` (cwd) | Root for recordings/, tracks/, jam_sessions.db |
| `JAM_DB_PATH` | `jam_sessions.db` | SQLite path (relative to DATA_DIR or absolute) |
| `JAM_INPUT_DIR` | `recordings` | Upload destination (relative to DATA_DIR or absolute) |
| `JAM_OUTPUT_DIR` | `tracks` | Exported tracks base dir (relative to DATA_DIR or absolute) |
| `JAM_CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed origins |
| `JAM_PORT` | `8000` | API server port |
| `JAM_MAX_UPLOAD_MB` | `500` | Maximum upload file size in MB |
| `JAM_JWT_SECRET` | *(empty)* | JWT signing key (required for auth) |
| `JAM_API_KEY` | *(empty)* | API key for CLI uploads (X-API-Key header) |
| `JAM_STATIC_DIR` | *(unset)* | SPA static file directory (enables catch-all route) |
| `JAM_R2_ACCOUNT_ID` | *(empty)* | Cloudflare R2 account ID |
| `JAM_R2_ACCESS_KEY_ID` | *(empty)* | R2 access key |
| `JAM_R2_SECRET_ACCESS_KEY` | *(empty)* | R2 secret key |
| `JAM_R2_BUCKET` | *(empty)* | R2 bucket name (enables remote storage when set) |
| `JAM_R2_CUSTOM_DOMAIN` | *(empty)* | Custom domain for R2 public URLs (skips presigned URLs) |

Path values stored in the DB are relative to `JAM_DATA_DIR`. The `config.resolve_path()` method resolves them to absolute at runtime. Already-absolute paths (from old DBs) pass through unchanged.

## Design Decisions

- **Output format:** AAC in M4A container at 192kbps. AAC was chosen over Opus for Safari/iOS compatibility.
- **Song detection:** Energy-based, not silence-based. A 15-second smoothing window and minimum duration filter distinguish actual songs from brief noodling between them.
- **Default threshold:** -20 dB with 120s minimum duration. For louder rooms or more noodling, raise the threshold (e.g., -15). For quieter recordings, lower it (e.g., -25).
- **Performance:** ffmpeg handles all decoding and segment export at the C level. A 1.5hr session processes in ~10 seconds.
- **Database:** SQLite — no server, portable, lives in the project directory
- **Backend API:** FastAPI — serves JSON endpoints and static audio files
- **Frontend:** React + TypeScript + Tailwind via Vite — clean separation from backend
- **Auth:** JWT in httponly cookies for browser sessions, API key via `X-API-Key` header for CLI. Bcrypt for password hashing.
- **Multi-tenancy:** Groups own sessions and songs. Users are assigned to groups. Role-based access control (superadmin > admin > editor > readonly).
- **Storage:** Pluggable backend via `storage.py`. Local filesystem by default; Cloudflare R2 when `JAM_R2_BUCKET` is set. Audio served via presigned URLs (or custom domain) when remote.
- **Song tagging:** Manual via web UI. Songs are scoped to groups and auto-created on first tag.

## Detailed Documentation

- [`docs/pipeline.md`](docs/pipeline.md) — processing pipeline data flow
- [`docs/roadmap.md`](docs/roadmap.md) — current, next, and future work items
