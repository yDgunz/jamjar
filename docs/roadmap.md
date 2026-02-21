# Roadmap

## Now

- Clean up local `input/` and `output/` on Docker volume (save disk after R2 migration)
- Deploy docs (so CI/CD setup isn't tribal knowledge)

## Next

- Background job processing (async upload/reprocess, progress tracking)
- Performance mode enhancements (auto-scroll, transposition, setlists)
- Frontend resilience (TanStack Query, optimistic updates)

## Later

- Database migrations (Alembic, evaluate Postgres)
- Observability (structured logging, Sentry, usage metrics)
- Security hardening (rate limiting, CSRF, input length limits)
- Data export (CSV/JSON catalog, zip downloads)
- Import & bulk ops (spreadsheet import, batch re-encode)
- Auto-suggest song names, duration/energy trends, playlists, multi-user notes
