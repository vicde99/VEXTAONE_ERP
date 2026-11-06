# VEXTAONE ERP

VEXTAONE ERP is being built incrementally for Philippine accounting and business consultancy operations. This repository starts with the Phase 1 foundation, not a claim that all requested ERP or BIR/CAS workflows are implemented or production-certified.

## Current implementation

- Phase 1 API foundation: PostgreSQL/Prisma data model for companies, branches, departments, users, roles, permissions, audit events, fiscal years, accounting periods, and chart of accounts.
- Password-hash authentication and opaque, server-stored sessions delivered in secure, HTTP-only cookies.
- Role/permission middleware, authentication throttling, security headers, origin checking for state-changing requests, and audit events for authentication.
- Seeded least-privilege role/permission catalog. Bootstrap administrator is created only when explicit bootstrap environment variables are set.
- Architecture, dependency map, initial ERD, roadmap, and compliance scope notes in `docs/`.

The API is an initial foundation. User/role administration endpoints, MFA, full audit-event coverage, accounting posting, frontend, and subsequent ERP modules remain unimplemented and are tracked in the roadmap.

## Requirements

- Node.js 20+
- PostgreSQL 15+

## Local setup

1. Copy `apps/api/.env.example` to `apps/api/.env` and set a strong `SESSION_SECRET` (32+ random bytes) and `DATABASE_URL`.
2. Install dependencies: `npm install`.
3. Generate Prisma Client and apply the database migration: `npm run db:generate && npm run db:migrate`.
4. Optionally configure all three bootstrap variables (`BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_COMPANY_NAME`) before seeding. Use a unique temporary password and change it through a future user-management workflow; never commit secrets.
5. Seed the permission and role catalog: `npm run db:seed`.
6. Start the API: `npm run dev`. Health check: `GET http://localhost:4000/health`.

For local HTTP development, set `COOKIE_SECURE=false`. In production, terminate TLS, set `COOKIE_SECURE=true`, configure `APP_ORIGIN` to the exact trusted frontend origin, and use managed secrets and database backups. Do not expose the API publicly until MFA, account recovery, user administration, operational monitoring, and a security review are complete.

## API (initial)

- `POST /api/auth/login` — `{ "email": "...", "password": "..." }`; creates a server-side session and sets an HTTP-only cookie.
- `POST /api/auth/logout` — ends the current session.
- `GET /api/auth/me` — current user and active company memberships.
- `GET /api/companies` — companies visible to the authenticated user.
- `GET /api/companies/:companyId/accounts` — active COA entries for an authorized company.
- `GET /health` — liveness check (does not reveal database credentials).

Mutating requests require the configured same-origin `Origin` (or `Referer`) check. Sessions are opaque random tokens; only their SHA-256 hashes are stored. The initial implementation is not a substitute for an independent security assessment.

## Development quality

`npm test` runs the API test suite; `npm run build` type-checks and compiles the API. Financial posting, tax computations, and BIR/CAS submissions are deliberately not implemented in this foundation phase. Philippine tax rules must be verified by authorized professionals and configured effective-dated; the application must not be represented as BIR-approved or CAS-compliant by default.
