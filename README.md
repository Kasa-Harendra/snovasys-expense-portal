# BalanceVault

A secure, enterprise-grade financial ledger and account management system built with **React**, **Node.js**, **Express**, **Prisma**, **PostgreSQL**, and **Redis**.

---

## System Architecture

- **Frontend**: React 18, Vite, TypeScript, responsive clean banking design system with custom CSS variables and typography (`Inter` + editorial serif accents).
- **Backend**: Node.js, Express, TypeScript, JWT-based authentication, RBAC middleware, and audit logging.
- **Database & ORM**: PostgreSQL with Prisma ORM, role-separated privileges (`balancevault_app`, `bootstrap_operator`, `admin_bootstrap` stored procedure), BigInt paise ledger precision, and ACID transactional integrity.
- **Cache & Rate Limiting**: Redis container integration for token-bucket sliding rate limiting (10 requests per 15 minutes with standard IETF `ratelimit` / `ratelimit-policy` headers).
- **Observability**: Health and readiness probes (`/api/ready`, `/api/health`).

---

## Features Implemented ("What I built")

1. **React-Based Frontend**:
   - Authentication views: Login, Registration, Accept Invitation.
   - Core application shell with sidebar navigation, active page headers, live backend connection badge, and user dropdown.
   - Dashboard Overview: aggregate balances, quick action triggers (Deposit, Withdraw, Transfer), accounts overview, and transaction feeds.
   - Accounts Page: active accounts breakdown, account selection for actions, and direct statement exploration.
   - Statements Page: granular credit/debit transaction activity, posted vs. refused attempts, running balances, and timestamps.
   - Account Requests: user onboarding workflow to request checking, savings, or business accounts.
   - Admin Controls:
     - User management (search, role filters, activate/deactivate accounts, user invitation generation).
     - Account onboarding queue (approve with custom account numbers, reject with review notes).
     - Complete immutable audit log viewer with actor details and JSON metadata viewer.
2. **Node.js Backend with API Routes**:
   - `/api/ready` & `/api/health`
   - `/api/auth/login`, `/api/auth/register`, `/api/auth/accept-invitation`, `/api/auth/change-password`
   - `/api/users/me` (profile management)
   - `/api/accounts`, `/api/accounts/:id`, `/api/accounts/:id/balance`, `/api/accounts/:id/statement`
   - `/api/deposits`, `/api/withdrawals`, `/api/transfers`, `/api/transfers/:id`
   - `/api/account-requests`, `/api/account-requests/admin/queue`, `/api/account-requests/admin/:id/approve`, `/api/account-requests/admin/:id/reject`
   - `/api/admin/users`, `/api/admin/users/:id/status`
   - `/api/admin/invitations`, `/api/admin/invitations/:id/revoke`
   - `/api/audit`
3. **PostgreSQL Database Integration using Prisma**:
   - Separate database roles configured: `balancevault_app`, `bootstrap_operator`, `balancevault_admin_role`.
   - Security-definer `admin_bootstrap` stored procedure.
4. **Redis Integration**:
   - Connection status verification on `/api/ready`.
   - Rate limiting on sensitive endpoints.

---

## Quick Start & Local Execution

### 1. Prerequisites (Docker)
Ensure Docker is running with the PostgreSQL and Redis containers:
```bash
# PostgreSQL container (port 5432)
docker run -d --name balancevault-postgres -p 5432:5432 -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=balancevault postgres:15-alpine

# Redis container (port 6380)
docker run -d --name redis -p 6380:6379 redis:alpine
```

### 2. Generate Prisma Client
```bash
npm run db:generate
```

### 3. Run Database Migrations
```bash
npm run db:migrate
```

### 4. Seed Development Data
```bash
npm run db:seed
```

### 5. Start the Application
Start both backend and frontend concurrently:
```bash
npm run dev
```

- **Frontend**: [http://localhost:5173](http://localhost:5173)
- **Backend API**: [http://localhost:3000](http://localhost:3000)
- **Health / Readiness Endpoint**: [http://localhost:3000/api/ready](http://localhost:3000/api/ready)

### Seed Credentials
- **Account Holder**:
  - Email: `harendrakasa@gmail.com`
  - Password: `KH20057v@balancev`
- **System Administrator**:
  - Email: `admin@balancevault.internal`
  - Password: `AdminVault2026!`
