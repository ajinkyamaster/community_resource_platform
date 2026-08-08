# Community Resource Curation Platform

Phase 0/1 baseline for a multi-tenant resource-sharing app.

## Documentation

- [DECISIONS.md](./DECISIONS.md) - A running log of architectural decisions and bugs found/fixed, phase by phase.
- *(Note: A phased roadmap exists, this repo is currently completing Phase 0/1 of a larger, staged project.)*

<!-- TODO: Create ARCHITECTURE.md in Phase 2 when the async pipeline is introduced -->

## Services

- `api/`: Node.js/Express primary backend
- `frontend/`: Next.js client
- `worker/`: Python scaffold reserved for ML work later

## Stack

- API: Node.js/Express
- Database: Postgres
- Frontend: Next.js
- Auth: stateless JWT

## Tenant isolation

- `groups`, `group_members`, `group_join_requests`, and `resources` are protected with Postgres RLS.
- The API sets `app.user_id` per request before any tenant-scoped query.
- RLS is forced on the tenant tables. To ensure it takes effect, the Express app connects using a dedicated least-privilege role (`app_user`) rather than the `postgres` superuser (which would unconditionally bypass RLS).
- A separate admin/migration connection string (superuser) is maintained solely for schema migrations. This ensures the runtime app cannot accidentally perform schema changes.

## Current scope

- Signup/login with JWT
- Create and join groups
- List groups, members, and resources
- Create resources synchronously with `status = 'processed'`
- No queue, worker logic, embeddings, or ranking yet

## Prerequisites

- **Node.js** (v18+)
- **Docker** and **Docker Compose**
- A local `.env` file setting `DATABASE_URL` and `JWT_SECRET` (see Local development).

## Local development

1. Set `DATABASE_URL` and `JWT_SECRET` in a root `.env` file or export them in your shell.
2. Start the stack with `docker compose up --build`.
3. API runs on `http://localhost:3001`.
4. Frontend runs on `http://localhost:3000`.
5. The worker container is present as a placeholder and just boots the Python scaffold.

## Testing

Run the full automated backend test suite via:

```bash
./run_tests.sh
```

*(Note: By design, this script performs a double fresh-database-reset (`docker compose down -v` followed by migrations) before running the suite. This is a deliberate choice to aggressively catch and expose any hidden dependencies on leftover state between runs.)*

## Implementation notes

- The API and SQL schema live together under `api/`.
- The worker is intentionally minimal until Phase 3.
