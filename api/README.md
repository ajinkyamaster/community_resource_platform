# API Service

Node.js/Express primary backend for Phase 0/1.

## Notes

- JWT auth is stateless.
- Request-scoped tenant identity is injected into Postgres with `set_config('app.user_id', ..., true)` inside a transaction.
- Postgres RLS remains the source of tenant isolation.
