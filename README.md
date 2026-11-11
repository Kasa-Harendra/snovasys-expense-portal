# BalanceVault

A secure, multi-tenant financial ledger and account management system built with **React**, **TypeScript**, **Node.js**, **Express**, **Prisma**, **PostgreSQL**, and **Redis**.

> **Hackathon Demonstration Notice**: This deployment is intended as a hackathon demonstration using synthetic data, not as a production financial service or a system for handling real funds.

---

## Live Deployment

- **Application URL**: [https://balancevault-app-production.up.railway.app](https://balancevault-app-production.up.railway.app)
- **Readiness Probe**: [https://balancevault-app-production.up.railway.app/api/ready](https://balancevault-app-production.up.railway.app/api/ready)
- **Health Probe**: [https://balancevault-app-production.up.railway.app/api/health](https://balancevault-app-production.up.railway.app/api/health)

In production, Railway runs a single unified Express service backed by managed PostgreSQL and Redis instances. Express handles `/api/*` endpoints behind Railway's reverse proxy (`trust proxy: 1`) and serves the compiled React SPA from `frontend/dist` with client-side routing fallback.

---

## Key Capabilities

- **Authentication & Role-Based Access Control (RBAC)**:
  - JWT Bearer authentication with live database `isActive` checks in [`authenticate`](backend/src/middleware/auth.ts) so deactivated users are blocked immediately (`HTTP 403`).
  - Three roles enforced server-side via [`requireRole`](backend/src/middleware/auth.ts): `ACCOUNT_HOLDER`, `ADMIN`, and `AUDITOR`.
- **Atomic Financial Ledger**:
  - All monetary values stored and computed strictly in integer **paise** (`BigInt`, `100 paise = ₹1.00`)—no floating-point arithmetic.
  - Deposits, withdrawals, and internal transfers execute inside atomic `prisma.$transaction` blocks using conditional balance decrements (`where: { balance: { gte: amount }, status: 'ACTIVE' }`) to prevent overdrafts and concurrent double-spend TOCTOU races.
  - Refused insufficient-funds attempts and idempotent replays (`Idempotency-Key` header) are recorded in `statement_events` and `transfers` (returning `409 Conflict` on key reuse with mismatched parameters).
- **Onboarding & Administration**:
  - Self-registration provisions an initial personal INR ledger account (`ACTIVE`) and complimentary activation credit.
  - Additional account requests (`PERSONAL`, `SAVINGS`, `BUSINESS`) move through an audited `PENDING` → `APPROVED` / `REJECTED` state machine.
  - Administrators can inspect accounts, manage user active statuses, issue/revoke 32-byte onboarding invitation tokens, and review append-only `audit_logs` alongside `AUDITOR` users.
- **Database Privilege Separation & First-Admin Bootstrap**:
  - Prisma migration `0_init` provisions dedicated PostgreSQL roles (`balancevault_app`, `bootstrap_operator`, `balancevault_admin_role`) and the `SECURITY DEFINER` function `admin_bootstrap(...)`.
  - Out-of-band CLI [`bootstrap-admin.ts`](backend/scripts/bootstrap-admin.ts) provisions the initial active administrator idempotently using `BOOTSTRAP_ADMIN_*` environment variables (never exposed via an unauthenticated HTTP route).
- **Rate Limiting & Observability**:
  - Redis sliding counter via [`createRateLimiter`](backend/src/middleware/rateLimit.ts) (`loginLimiter`: 10 requests per 15 minutes on `POST /api/auth/login`) emitting standard IETF `ratelimit` / `ratelimit-policy` headers (`family: 0` dual-stack DNS configured for Railway private networking).
  - Security headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`), `x-powered-by` disabled, and graceful `SIGTERM`/`SIGINT` connection draining.

---

## System Architecture & Repository Layout

```text
├── .github/workflows/ci.yml        # GitHub Actions CI (Postgres + Redis containers, build, npm test)
├── railway.toml                    # Railpack build + unified production start configuration
├── docker-compose.yml              # Local PostgreSQL 15 & Redis containers with healthchecks
├── package.json                    # Root npm workspaces scripts (build, start, start:prod, test)
├── frontend/
│   ├── index.html
│   └── src/
│       ├── api/client.ts           # Typed API client with Idempotency-Key header support
│       ├── context/AuthContext.tsx # Session state and role helpers
│       ├── components/             # Layout shell, navigation, and shared UI icons
│       └── pages/                  # Auth, Dashboard, Accounts, Ledger, Transactions, Admin, Settings
└── backend/
    ├── prisma/
    │   ├── schema.prisma           # PostgreSQL models & enums
    │   ├── migrations/0_init/      # Schema, constraints, DB roles, admin_bootstrap() function
    │   └── seed.ts                 # Idempotent demo seed (--if-empty flag preserves live data)
    ├── scripts/bootstrap-admin.ts  # CLI / startup administrator bootstrapper
    ├── src/
    │   ├── routes/                 # auth, users, accounts, transactions, accountRequests, admin, audit, health
    │   ├── middleware/             # JWT authentication, RBAC guards, Redis rate limiter, audit logging
    │   └── index.ts                # Express server, security headers, API router, SPA fallback
    └── tests/                      # auth, onboarding, admin, security, and Puppeteer E2E suites
```

---

## Security & AI Engineering Documentation

- **[THREATS.md](THREATS.md)**: Trust boundaries, STRIDE threat matrix, IDOR controls, TOCTOU double-spend prevention, mass-assignment defenses, and verification mapping.
- **[PROMPTS.md](PROMPTS.md)**: Dated engineering prompt log documenting AI interactions, security/deployment flaws caught in review, and code fixes with commit links.

---

## Quick Start & Local Execution

### 1. Start Infrastructure (Docker Compose)
```bash
docker compose up -d
```
*(Starts PostgreSQL 15 on port `5432` and Redis on port `6380` with healthchecks.)*

### 2. Install Dependencies & Generate Prisma Client
```bash
npm install
npm run db:generate
```

### 3. Apply Database Migrations, Bootstrap Admin & Seed Demo Data
```bash
npm run db:migrate
npm run bootstrap:admin
npm run db:seed
```

### 4. Start Development or Production Mode
**Development (Vite HMR + tsx watch):**
```bash
npm run dev
```
- **Frontend (Vite)**: [http://localhost:5173](http://localhost:5173)
- **Backend API**: [http://localhost:3000](http://localhost:3000)

**Unified Production Build (matches Railway):**
```bash
npm run build
NODE_ENV=production npm run start:prod
```
`start:prod` runs `prisma migrate deploy`, `bootstrap:admin`, `db:seed -- --if-empty`, and launches Express serving both `/api` and the compiled SPA on `PORT` (default `3000`).

---

## Railway Deployment Configuration

Configured via [railway.toml](railway.toml) and root [package.json](package.json):
- **Build command**: `npm run build` (runs `prisma generate`, `frontend` `tsc && vite build`, and `backend` `tsc`)
- **Start command**: `npm run start:prod`
- **Healthcheck**: `GET /api/ready`
- **Required Railway service variables**:
  - `DATABASE_URL` (linked to Railway PostgreSQL)
  - `REDIS_URL` (linked to Railway Redis)
  - `JWT_SECRET` (strong random 256-bit+ hex secret)
  - `JWT_EXPIRES_IN=900`
  - `NODE_ENV=production`
  - `NPM_CONFIG_PRODUCTION=false` *(needed during Railpack build for TypeScript/Vite devDependencies)*
  - `RAILPACK_NODE_VERSION=22`
  - `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`

---

## Automated Verification & Test Suites

Run the backend API and security test suite against a running API server + local PostgreSQL/Redis (`npm run build` / `npm run dev` running on port `3000`):
```bash
npm test
```

Individual suites:
- `npm --workspace=backend run test:auth` — Customer/admin login, JWT payload checks, inactive user rejection, Redis rate-limit headers.
- `npm --workspace=backend run test:onboarding` — Registration with initial INR account, account-request submission, and transactional admin approval.
- `npm --workspace=backend run test:admin` — User search, status toggling, 32-byte invitation lifecycle, and audit-log RBAC rejection (`403` for account holders).
- `npm --workspace=backend run test:security` — Threat-model verification (`THREATS.md`): mass assignment, cross-account IDOR, negative/malformed amounts, 5-way concurrent double-spend protection, idempotency replay, and audit trail checks.
- `npm --workspace=backend run test:browser` — Headless Chrome E2E suite across customer and admin routes with zero console/page errors:
  ```bash
  # Target local frontend (http://localhost:5173) or unified server / live Railway deployment:
  TEST_FRONTEND_URL="https://balancevault-app-production.up.railway.app" npm --workspace=backend run test:browser
  ```

---

## Demo Seed Credentials

- **Account Holder**:
  - Email: `harendrakasa@gmail.com`
  - Password: `KH20057v@balancev`
- **System Administrator**:
  - Email: `admin@balancevault.internal`
  - Password: `AdminVault2026!`
- **Compliance Auditor**:
  - Email: `auditor@balancevault.internal`
  - Password: `AuditorVault2026!`
