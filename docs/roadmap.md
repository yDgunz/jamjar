# Roadmap

## Go-live prerequisites

- Pre-deploy database backup — call `scripts/backup-db.sh` in the deploy workflow before `docker compose up --build -d`
- Health check — make `GET /health` verify DB connectivity (`SELECT 1`), add `HEALTHCHECK` directive to Dockerfile and docker-compose.yml
- Rate limiting on login — add `slowapi` or similar with per-IP limit on `/api/auth/login` to prevent brute force
- Input length limits — add `max_length` constraints to all Pydantic string fields (`song_name`, `notes`, `name`, `artist`, `sheet`, etc.)

## Go-live follow-ups

- Deploy rollback strategy — tag or keep the previous Docker image before rebuilding so a bad deploy can be reverted without manual SSH fixes
- Automated backup schedule — set up a cron job (host or container) running `backup-db.sh` daily; script already handles 30-backup rotation
- Schema migrations — replace hand-rolled `_migrate()` in `db.py` with Alembic for versioned, reversible migrations

## Later

- Review PWA caching changes — audit commits 2ef72c6, 7adafd6, 5ab86ad for tech debt (switched navigateFallback to NetworkFirst, added skipWaiting/clientsClaim, no-cache headers on sw.js/index.html, controllerchange reload). May want to revert to precache-based navigation now that SW update lifecycle is fixed.
- Metronome
- Import chart from external source
- Star tracks
- Shareable link
- Observability (structured logging, Sentry, usage metrics)
- Security hardening (CSRF tokens for state-changing operations)
- Data export (CSV/JSON catalog, zip downloads)
- Frontend resilience (TanStack Query, optimistic updates)
