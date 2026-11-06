# VEXTAONE ERP

VEXTAONE ERP is being built incrementally for Philippine accounting and business consultancy operations. This repository starts with the Phase 1 foundation, not a claim that all requested ERP or BIR/CAS workflows are implemented or production-certified.

## Current implementation

- Phase 1 API foundation: PostgreSQL/Prisma data model for companies, branches, departments, users, roles, permissions, audit events, fiscal years, accounting periods, and chart of accounts.
- Password-hash authentication and opaque, server-stored sessions delivered in secure, HTTP-only cookies.
- Role/permission middleware, authentication throttling, security headers, origin checking for state-changing requests, and audit events for authentication.
- Seeded least-privilege role/permission catalog. Bootstrap administrator is created only when explicit bootstrap environment variables are set.
- User/company management endpoints, account creation, and fiscal-year setup are now included in the Phase 1 foundation.
- Architecture, dependency map, initial ERD, roadmap, and compliance scope notes in `docs/`.

## Requirements

- Node.js 20+
- PostgreSQL 15+

## Local setup

1. Copy `apps/api/.env.example` to `apps/api/.env` and set a strong `SESSION_SECRET` (32+ random bytes) and `DATABASE_URL`.
2. Install dependencies: `npm install`.
3. Generate Prisma Client and apply the database migration: `npm run db:generate && npm run db:migrate`.
4. Optionally configure the bootstrap variables before seeding. Use a unique temporary password and change it later.
5. Seed the permission and role catalog: `npm run db:seed`.
6. Start the API: `npm run dev`. Health check: `GET http://localhost:4000/health`.

## API (Phase 1 baseline)

- `POST /api/auth/login` — `{ "email": "...", "password": "..." }`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/companies`
- `GET /api/companies/:companyId/accounts`
- `GET /api/admin/roles`
- `GET /api/admin/permissions`
- `GET /api/companies/:companyId/users`
- `POST /api/companies/:companyId/users`
- `POST /api/companies/:companyId/accounts`
- `GET /api/companies/:companyId/fiscal-years`
- `POST /api/companies/:companyId/fiscal-years`

This foundation is intentionally limited to the identity, RBAC, company, account, and fiscal-year layer. It is not a full ERP, tax engine, or production compliance certification.
