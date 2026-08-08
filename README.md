# Community Resource Curation Platform

Phase 0/1 baseline for a multi-tenant resource-sharing app.

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

## Local development

1. Set `DATABASE_URL` and `JWT_SECRET` in a root `.env` file or export them in your shell.
2. Start the stack with `docker compose up --build`.
3. API runs on `http://localhost:3001`.
4. Frontend runs on `http://localhost:3000`.
5. The worker container is present as a placeholder and just boots the Python scaffold.

## Implementation notes

- The API and SQL schema live together under `api/`.
- The worker is intentionally minimal until Phase 3.
