# BalanceVault

A secure, enterprise-grade financial ledger and account management system built with **React**, **Node.js**, **Express**, **Prisma**, **PostgreSQL**, and **Redis**.

> **Hackathon Demonstration Notice**: This deployment is intended as a hackathon demonstration using synthetic data, not as a production financial service or a system for handling real funds.

---

## System Architecture

- **Frontend**: React 18, Vite, TypeScript, responsive clean banking design system with custom CSS variables and typography (`Inter` + editorial serif accents).
- **Backend**: Node.js, Express, TypeScript, JWT-based authentication, RBAC middleware, and audit logging.
- **Database & ORM**: PostgreSQL with Prisma ORM, role-separated privileges (`balancevault_app`, `bootstrap_operator`, `balancevault_admin_role`), `SECURITY DEFINER` admin bootstrap function (`admin_bootstrap`), BigInt paise ledger precision, and ACID atomic conditional updates.
- **Cache & Rate Limiting**: Redis container integration for token-bucket sliding rate limiting (10 requests per 15 minutes with standard IETF `ratelimit` / `ratelimit-policy` headers).
- **Observability & Reliability**: Health and readiness probes (`/api/ready`, `/api/health`) with DB/Redis latency monitoring, security response headers, and graceful shutdown.

---

## Security & Documentation

- **[THREATS.md](THREATS.md)**: Complete STRIDE threat model, trust boundaries, IDOR prevention, double-spend race condition mitigations, and mass assignment protections.
- **[PROMPTS.md](PROMPTS.md)**: Dated engineering prompt log documenting AI interactions, caught security flaws, and architectural fixes.

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

### 3. Apply Database Migrations & Seed Data
```bash
npm run db:migrate
npm run db:seed
npm --workspace=backend run bootstrap:admin
```

### 4. Start the Application
Start both backend and frontend concurrently:
```bash
npm run dev
```
- **Frontend**: [http://localhost:5173](http://localhost:5173)
- **Backend API**: [http://localhost:3000](http://localhost:3000)
- **Health / Readiness Endpoint**: [http://localhost:3000/api/ready](http://localhost:3000/api/ready)

---

## Automated Verification & Test Suites

Run the complete verification suite (requires running backend, PostgreSQL, and Redis):
```bash
npm test
```

Individual test suites:
- `npm --workspace=backend run test:auth` — Admin/customer login, JWT claim verification, inactive user block, rate limits.
- `npm --workspace=backend run test:onboarding` — Registration, initial account assignment, request queue, and admin approval.
- `npm --workspace=backend run test:admin` — User search, status toggling, invitations, and audit log RBAC boundary.
- `npm --workspace=backend run test:security` — Penetration tests against `THREATS.md` (IDOR, mass assignment, negative amounts, 5-way concurrent double-spend, idempotency replay).
- `npm --workspace=backend run test:browser` — Headless Chromium end-to-end browser verification across all 13 frontend routes.

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
