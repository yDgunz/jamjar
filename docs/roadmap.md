# Roadmap

## Later

- Review PWA caching changes — audit commits 2ef72c6, 7adafd6, 5ab86ad for tech debt (switched navigateFallback to NetworkFirst, added skipWaiting/clientsClaim, no-cache headers on sw.js/index.html, controllerchange reload). May want to revert to precache-based navigation now that SW update lifecycle is fixed.
- Support for "add to home page"
- Offline mode
- Import lyrics/chart from external source
- Star tracks
- Shareable link
- Database migrations (Alembic, evaluate Postgres)
- Observability (structured logging, Sentry, usage metrics)
- Security hardening (rate limiting, CSRF, input length limits)
- Data export (CSV/JSON catalog, zip downloads)
- Frontend resilience (TanStack Query, optimistic updates)
