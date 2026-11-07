# VEXTAONE ERP

VEXTAONE ERP is being built incrementally for Philippine accounting and business consultancy operations. The current repository provides a backend foundation and an initial journal posting workflow; it is not the complete requested ERP and is not certified or approved for BIR/CAS use.

## Current implementation

- PostgreSQL and Prisma models for companies, branches, departments, users, roles, permissions, sessions, fiscal years, periods, chart of accounts, audit events, journal entries and lines.
- Password-hash authentication, server-side sessions, RBAC checks, company membership enforcement, security headers, authentication throttling, and exact-origin checks for state-changing requests.
- Phase 1 administration routes and the initial accounting journal posting/listing endpoints.
- Database-level journal posting controls: posting requires an open period, a valid in-period date, posting actor/time, balanced lines, and posted entries/lines are immutable.
- Architecture, dependency map, ERD, roadmap, and Philippine compliance boundaries in `docs/`.

The API is a foundation, not a production accounting system. It does not yet include approval workflows, generated sequential journal numbers, periods management UI, reversals, AR/AP, financial statements, or full audit/security testing. Production launch requires migration validation, build/tests, threat modeling, professional accounting/tax review, and backup/recovery verification.

## Requirements and setup

- Node.js 20+
- PostgreSQL 15+

1. Copy `apps/api/.env.example` to `apps/api/.env`, then set `DATABASE_URL`, `APP_ORIGIN`, and a strong `SESSION_SECRET` (at least 32 characters).
2. Install dependencies from the repository root: `npm install`.
3. Generate the Prisma client: `npm run db:generate`.
4. Apply migrations: `npm run db:migrate`.
5. Seed role and permission data: `npm run db:seed`.
6. Run `npm run dev`; health endpoint: `GET http://localhost:4000/health`.

Use `COOKIE_SECURE=false` only for local HTTP development; set it true behind HTTPS in deployed environments. The optional bootstrap administrator setup is described by the environment variables in `.env.example`; do not commit real credentials.

## Initial API

- `POST /api/auth/login` — authenticate and set an HTTP-only session cookie.
- `POST /api/auth/logout` and `GET /api/auth/me`.
- `GET /api/companies` — list companies available to the user.
- `GET /api/companies/:companyId/accounts` — list active accounts with permission.
- `GET /api/admin/companies/:companyId/users` and `POST` to create a company user.
- `GET/POST /api/admin/companies/:companyId/accounts` — read/create chart-of-accounts entries.
- `GET/POST /api/admin/companies/:companyId/fiscal-years`.
- `POST /api/companies/:companyId/journal-entries` — validate and post a balanced entry within an open accounting period. Requires `journal.post`.
- `GET /api/companies/:companyId/journal-entries` — filtered/paginated journal list. Requires `journal.read`.

Journal payload example:

```json
{
  "journalNo": "JE-2026-0001",
  "journalDate": "2026-01-15",
  "periodId": "00000000-0000-4000-8000-000000000001",
  "entryType": "GENERAL",
  "description": "Opening cash balance",
  "lines": [
    { "accountCode": "1000", "debit": "1000.00", "credit": "0" },
    { "accountCode": "3000", "debit": "0", "credit": "1000.00" }
  ]
}
```

Journal numbers must currently be supplied by the caller and must be unique within the company. Values use decimal strings to preserve cents. This endpoint posts immediately; approval and draft-review workflows are not implemented. Corrections to posted entries must not mutate them; reversal support remains planned.

## Build and tests

```bash
npm install
npm run db:generate
npm run build
npm test
```

BIR tax calculations, submissions, and CAS compliance are not implemented or claimed. Tax rules must be professionally reviewed, effective-dated and configurable before use.
