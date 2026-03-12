# Roadmap

Prioritized backlog, roughly ordered by importance.

1. Input length limits — add `max_length` constraints to all Pydantic string fields (`song_name`, `notes`, `name`, `artist`, `sheet`, etc.)
2. Rate limiting on login — add `slowapi` or similar with per-IP limit on `/api/auth/login` to prevent brute force
3. Health check — make `GET /health` verify DB connectivity (`SELECT 1`), add `HEALTHCHECK` directive to Dockerfile and docker-compose.yml
4. Security hardening (CSRF tokens for state-changing operations)
5. Test restore process — pull a backup from R2, restore it to a fresh SQLite DB, and verify data integrity; document the full disaster recovery procedure (new VPS from scratch)
6. Deploy rollback strategy — tag or keep the previous Docker image before rebuilding so a bad deploy can be reverted without manual SSH fixes
7. Schema migrations — replace hand-rolled `_migrate()` in `db.py` with Alembic for versioned, reversible migrations
8. Observability (structured logging, Sentry, usage metrics)
9. Separate audio processing worker — extract `_process_upload()` into a standalone worker process that polls the jobs table, decoupling CPU-heavy FFmpeg work from the API server so processing doesn't degrade request handling for other users
10. Data export (CSV/JSON catalog, zip downloads)
11. Show date coordination
12. Metronome
13. Import chart from external source
