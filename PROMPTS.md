# Engineering Prompt Log (PROMPTS.md)

This log records interactions with AI tools during the implementation of BalanceVault. Each entry corresponds directly to specific system requirements, documenting what was requested, what the tool produced, what was technically flawed or insecure, what was implemented instead, and the resulting commit.

---

### Requirement: Database Migrations & Separate Database Roles
- **Date**: 2026-11-07
- **Requirement Reference**: *"Database migrations and separate database roles for different responsibilities"*

#### What I asked for:
> "Write a PostgreSQL migration script to configure separate database roles for BalanceVault so that the runtime application has restricted permissions while a bootstrap operator can provision the first administrator."

#### What the tool produced:
The AI suggested granting superuser permissions to the application user and using `ALTER ROLE`:
```sql
ALTER ROLE admin WITH SUPERUSER;
ALTER ROLE postgres WITH PASSWORD 'admin_password';
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO balancevault_user;
```

#### What was wrong with it:
1. **Cloud Environment Violation**: On managed PostgreSQL services (such as Neon and Supabase), project-owner connections lack superuser privileges. Executing `ALTER ROLE ... WITH SUPERUSER` failed with PostgreSQL error `SQLSTATE 42501 (insufficient privilege)`.
2. **Security Anti-Pattern**: The AI confused role membership with permission to administer another PostgreSQL role. Giving the runtime web application superuser rights is a severe security vulnerability that violates least privilege.

#### What I did instead:
Inspected the actual PostgreSQL role structure and established clear role boundaries:
- Created separate database roles: `balancevault_app` (restricted DML only), `bootstrap_operator` (bootstrap role membership), and `balancevault_admin_role`.
- Encapsulated the administrator provisioning inside a PostgreSQL `SECURITY DEFINER` function `admin_bootstrap(admin_name, admin_email, admin_password_hash)` that executes with owner privileges while exposing a strictly typed interface.
- Granted execution privileges on `admin_bootstrap()` solely to `bootstrap_operator`.

- **Commit**: [`c89438a`](commit://c89438a)

---

### Requirement: Account Statements & IDOR Access Control
- **Date**: 2026-11-08
- **Requirement Reference**: *"Authentication and role-based access-control implementation"* & *"Managing financial accounts requires controlled access"*

#### What I asked for:
> "Create an Express API endpoint `GET /api/accounts/:id/statement` that retrieves paginated transaction ledger entries for a given account ID."

#### What the tool produced:
```typescript
export async function getAccountStatements(req: Request, res: Response) {
  const { id } = req.params;
  const events = await prisma.statementEvent.findMany({
    where: { accountId: id },
    orderBy: { timestamp: 'desc' },
    take: Number(req.query.limit) || 20,
  });
  return res.json({ events });
}
```

#### What was wrong with it:
**Insecure Direct Object Reference (IDOR)**:
The endpoint blindly trusted `req.params.id` without validating whether the requesting user owned that account. An authenticated customer could query any arbitrary account UUID and inspect another user's entire balance history, transaction activity, and counterparty records.

#### What I did instead:
Implemented mandatory ownership and role-based access control before querying the ledger:
1. Queried the account to check `account.userId === req.user.id`.
2. Allowed access only if the requester is the verified account owner OR possesses an administrative/compliance role (`Role.ADMIN` or `Role.AUDITOR`).
3. If unauthorized, immediately returned `403 Forbidden` (`reason: 'not_authorized'`) and recorded an unauthorized access attempt in `audit_logs`.

- **Commit**: [`c89438a`](commit://c89438a)

---

### Requirement: Complete and Verify the First-Admin Bootstrap Process
- **Date**: 2026-11-09
- **Requirement Reference**: *"Complete and verify the first-admin bootstrap process"*

#### What I asked for:
> "How should we implement the first administrator bootstrap process after deployment without hardcoding credentials or exposing sensitive endpoints?"

#### What the tool produced:
The AI proposed exposing an unauthenticated HTTP endpoint:
```typescript
router.post('/api/bootstrap-first-admin', async (req, res) => {
  const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
  if (adminCount > 0) return res.status(400).json({ error: 'Already bootstrapped' });
  const admin = await prisma.user.create({ data: { ...req.body, role: 'ADMIN' } });
  return res.json({ admin });
});
```

#### What was wrong with it:
**Public Race Condition Vulnerability**:
An unauthenticated bootstrap HTTP endpoint deployed to a public URL creates a race condition where external attackers or bots can hit the endpoint immediately upon server startup and take permanent administrative control of the financial system.

#### What I did instead:
Built an offline operator CLI (`backend/scripts/bootstrap-admin.ts`) that runs locally out-of-band:
- Requires direct terminal access (`npm run bootstrap:admin`).
- Checks if an active administrator already exists before executing.
- Calls the PostgreSQL `admin_bootstrap()` security definer function, hashes passwords using bcrypt with cost factor 12, and automatically logs a `FIRST_ADMIN_BOOTSTRAPPED` audit entry with operator host metadata.

- **Commit**: [`68880f8`](commit://68880f8)

---

### Requirement: Verify Admin Login Against the Deployed Backend
- **Date**: 2026-11-09
- **Requirement Reference**: *"Verify admin login against the deployed backend"* & *"Redis integration for backend rate limiting"*

#### What I asked for:
> "Write an automated verification test script for admin authentication and ensure deactivated user accounts are strictly blocked from logging in."

#### What the tool produced:
The AI generated a superficial test checking only that status was 200 and a token string was returned. For account deactivation, it proposed checking `user.isActive` in client-side React code after issuing a token.

#### What was wrong with it:
1. **Client-Side Security Flaw**: Checking `isActive` on the frontend is completely ineffective; an attacker can call the API directly using valid credentials even after an admin deactivates them. The API gateway must reject deactivated users with `403 Forbidden` before issuing tokens.
2. **Missing Token Assertions**: The test failed to verify cryptographic token claims (`sub`, `iss`, `aud`, `role`, and expiration), meaning a malformed or improperly signed token would pass unnoticed.
3. **Ignored Rate Limiting**: Did not verify Redis sliding-window rate limit headers.

#### What I did instead:
- Updated the authentication controller to check `if (!user.isActive) return res.status(403).json({ reason: 'account_inactive' })`.
- Attached Redis rate limiting to `/api/auth/login` emitting standard IETF headers (`ratelimit: "10-in-15min"`).
- Built `backend/tests/auth.test.ts` to assert:
  - Valid admin login issuing Bearer token with role `ADMIN`.
  - Constant-time password validation returning generic 401 on bad credentials (anti-enumeration).
  - Explicit cryptographic signature verification with JWT payload assertions.
  - Active status rejection with `HTTP 403 Forbidden`.
  - Redis rate-limit headers validation (`ratelimit`, `ratelimit-policy`).

- **Commit**: [`91f1ff6`](commit://91f1ff6)

---

### Requirement: Test Registration and Onboarding Workflows End to End
- **Date**: 2026-11-09
- **Requirement Reference**: *"Test the complete registration and onboarding workflows end to end"*

#### What I asked for:
> "Implement and test the customer registration and onboarding flow where a user registers, receives an initial personal account, requests an additional business account, and the admin approves it."

#### What the tool produced:
The AI suggested a direct account creation endpoint without any formal state machine, approval queue, or transactional locking.

#### What was wrong with it:
**Lack of Auditability and State Machine Integrity**:
In financial accounting, accounts cannot appear without an audited, non-repudiable state transition. If an account is created without linking to the approved request, compliance auditors cannot trace who approved the account, when it was requested, or why it was opened. Furthermore, separating the request status update from account creation can result in partial failure if the database disconnects halfway through.

#### What I did instead:
- Built a formal state machine: `AccountRequest` (`PENDING` -> `APPROVED` / `REJECTED`).
- Implemented `POST /api/account-requests/admin/:id/approve` using `prisma.$transaction` so that the request status update, new `Account` creation with unique account number, and audit logging happen atomically.
- Wrote end-to-end integration test `backend/tests/onboarding.test.ts` testing the complete lifecycle from registration to approval.

- **Commit**: [`869cda5`](commit://869cda5)

---

### Requirement: Verify Admin User Management and Audit-Log Functionality
- **Date**: 2026-11-09
- **Requirement Reference**: *"Verify admin user management and audit-log functionality through the live interface"*

#### What I asked for:
> "Create a test suite to verify admin user management (search, status toggling, invitations) and audit log queries."

#### What the tool produced:
The AI wrote tests only for the happy path (admin performing admin operations). It did not include negative security tests asserting that non-admin users cannot access administrative endpoints or view audit trails.

#### What was wrong with it:
**Missing Negative Security Boundary Verification**:
The highest evaluation marks (35 marks for security and integrity) focus on what a judge can break. A test suite that only verifies that an admin can do admin tasks does not guarantee that a regular account holder cannot call `GET /api/audit` or `PATCH /api/admin/users/:id/status`.

#### What I did instead:
Created `backend/tests/admin.test.ts` with comprehensive positive and negative tests:
1. Logged in as both `ADMIN` and `ACCOUNT_HOLDER`.
2. Verified user search, pagination, and active status toggling.
3. Created and revoked 32-byte cryptographic invitation tokens.
4. **Negative RBAC Assertion**: Verified that an `ACCOUNT_HOLDER` calling `GET /api/audit` is immediately rejected with `HTTP 403 Forbidden`.
5. Verified that administrative actions append immutable records into `audit_logs` storing actor ID, actor email, IP address, user-agent, and structured metadata.

- **Commit**: [`f7f9296`](commit://f7f9296)

---

### Requirement: Complete Browser-Based Testing of the Deployed Application
- **Date**: 2026-11-09
- **Requirement Reference**: *"Complete browser-based testing of the deployed application"* & *"A deployed React-based frontend"*

#### What I asked for:
> "Run end-to-end browser tests across all frontend routes and diagnose why some pages fail to render or display transactions and audit logs."

#### What the tool produced:
The AI suggested that Vite dev server was simply missing route configuration or that client-side components needed simulated mock arrays hardcoded in state.

#### What was wrong with it:
Running deep browser runtime diagnostics revealed the real root causes:
1. **Dynamic Chunk 404s**: Vite was looking for dynamic chunk filenames matching `FinancialTransactionPage-596NOUVs.js` and `LedgerPages-DGZaI5CJ.js`. The assets had been saved without their build hash suffixes, causing deposit, withdrawal, transfer, and audit views to crash on dynamic import failure.
2. **API Response Contract Mismatch**:
   - The frontend expected `account.currencyCode` and `balancePaise`, whereas the backend was returning `currency` and `balance`.
   - In `GET /api/accounts/:id/statement`, the frontend component expected `{ account: { ... }, events: [...] }`, causing an unhandled `Cannot read properties of undefined (reading 'currencyCode')` error when accessing `a.account.currencyCode`.
   - In `GET /api/audit`, the frontend expected `{ events: [...] }` with `a.actor.email` and `a.entityType`, whereas the backend was returning `{ records: [...] }`.

#### What I did instead:
- Aligned chunk filenames with `__vite__mapDeps` so all dynamic modules load cleanly.
- Updated `backend/src/routes/accounts.ts`, `backend/src/routes/transactions.ts`, and `backend/src/routes/audit.ts` to return both `currency` and `currencyCode`, `balancePaise`, the full `account` envelope on statements, and `{ events: [...] }` on audit logs.
- Built a permanent headless browser test suite (`backend/tests/e2e-browser.test.ts`) that signs in as both customer and admin, navigates all 13 routes, and confirms zero console errors and clean DOM renders.

- **Commit**: [`92bf34b`](commit://92bf34b)

---

### Requirement: Integrity, Security & Threat Model Verification
- **Date**: 2026-11-10
- **Requirement Reference**: *"Managing financial accounts and their associated operations requires controlled access, secure authentication, and accountability"*

#### What I asked for:
> "Write the withdrawal and transfer transaction handlers in `backend/src/routes/transactions.ts` to prevent overdrafts and duplicate transfers, and test them against concurrent attacks."

#### What the tool produced:
The AI generated a read-then-write balance check:
```typescript
const account = await prisma.account.findUnique({ where: { id: accountId } });
if (account.balance < amount) {
  return res.status(400).json({ error: 'Insufficient funds' });
}
await prisma.$transaction(async (tx) => {
  await tx.account.update({
    where: { id: account.id },
    data: { balance: { decrement: amount } },
  });
});
```

#### What was wrong with it:
1. **TOCTOU Race Condition (Double-Spend)**: Checking `account.balance < amount` outside the database update permits a classic Time-of-Check to Time-of-Use race condition. If an attacker fires 5 concurrent full-balance withdrawal requests simultaneously, all 5 pass the pre-check before any transaction commits, driving the account balance deeply negative.
2. **Unsafe Numeric Parsing**: Calling `BigInt(amountPaise)` directly threw an unhandled `SyntaxError` (HTTP 500) on malformed input strings like `"10.50"` or `"abc"`.
3. **Missing Transfer Detail Authorization**: `GET /api/transfers/:id` did not verify whether the requesting user owned either the source or destination account.

#### What I did instead:
- Replaced the non-atomic read-then-decrement with an atomic conditional PostgreSQL update inside `prisma.$transaction`:
  ```typescript
  const updateResult = await tx.account.updateMany({
    where: { id: account.id, balance: { gte: amount }, status: 'ACTIVE' },
    data: { balance: { decrement: amount } },
  });
  if (updateResult.count === 0) throw new InsufficientFundsError();
  ```
- Added `parsePositivePaise()` regex validation (`/^[1-9]\d*$/`) returning clean HTTP 400 on negative, zero, or decimal strings.
- Added ownership validation to `GET /api/transfers/:id` and audit logging on unauthorized deposit/withdrawal/transfer attempts.
- Created `backend/tests/security.test.ts` testing IDOR, mass assignment, input tampering, privilege escalation, idempotency replay, and a 5-way concurrent double-spend attack.

- **Commit**: [`ee93ec8`](commit://ee93ec8)

---

### Requirement: Improve Deployment Monitoring and Operational Reliability
- **Date**: 2026-11-10
- **Requirement Reference**: *"Improve deployment monitoring and operational reliability"* & *"Backend health and readiness endpoints"*

#### What I asked for:
> "Add monitoring metrics to `/api/health` and `/api/ready`, security response headers, and graceful server shutdown for container deployments."

#### What the tool produced:
The AI returned the raw exception message directly in `/api/ready` and the global error handler:
```typescript
catch (err: any) {
  return res.status(503).json({ status: 'not_ready', error: err.message });
}
```
It also omitted `SIGTERM` graceful connection draining and left Express's default `X-Powered-By` fingerprint header enabled.

#### What was wrong with it:
1. **Information Disclosure in Error Responses**: Returning raw `err.message` from database failures on an unauthenticated `/api/ready` or 500 error response can expose internal PostgreSQL hostnames, connection strings, or stack traces to external attackers.
2. **Abrupt Connection Drops on Redeploy**: Without `SIGTERM`/`SIGINT` handlers, container restarts abruptly drop active PostgreSQL queries and Redis connections, risking half-finished transactions.

#### What I did instead:
- Updated `backend/src/routes/health.ts` to measure live `dbLatencyMs` and `redisLatencyMs` while logging internal errors strictly server-side and returning sanitized `not_ready` payloads to callers.
- Added memory usage (`rssMb`, `heapUsedMb`) and uptime reporting on `/api/health`.
- Disabled `x-powered-by` and added `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, and `Permissions-Policy` headers in `backend/src/index.ts`.
- Implemented graceful `SIGTERM`/`SIGINT` shutdown draining the HTTP server, Prisma client, and Redis socket cleanly.
- Added `docker-compose.yml` with PostgreSQL and Redis healthchecks.

- **Commit**: [`e7ab6b8`](commit://e7ab6b8)

---

### Requirement: Deployment CI Pipeline & End-to-End Verification
- **Date**: 2026-11-11
- **Requirement Reference**: *"Improve deployment monitoring and operational reliability"* & *"Synthetic hackathon demonstration verification"*

#### What I asked for:
> "Create a GitHub Actions CI workflow that builds both frontend and backend, migrates PostgreSQL, seeds the database, and runs all verification suites automatically."

#### What the tool produced:
The AI generated a workflow that ran `npm test` directly in a single step without starting PostgreSQL/Redis service containers, running `prisma generate`, or launching the API server prior to executing the HTTP integration tests.

#### What was wrong with it:
1. **Missing Service Containers & Healthchecks**: Integration and security tests require live PostgreSQL and Redis instances. Running `npm test` without service containers and healthcheck wait conditions causes immediate connection failures.
2. **Unbuilt Workspace Order**: Running `tsx` or `node dist/index.js` without first generating the Prisma client (`npm run db:generate`) and compiling TypeScript (`npm run build`) fails on missing `@prisma/client` types.

#### What I did instead:
- Configured `.github/workflows/ci.yml` with `postgres:15-alpine` and `redis:alpine` service containers with explicit `pg_isready` and `redis-cli ping` healthchecks.
- Sequenced steps cleanly: `npm ci` -> `npm run db:generate` -> `db:push` -> `npm run build` -> `db:seed` & `bootstrap:admin` -> start backend -> verify `/api/ready` -> run unified `npm test`.
- Added root `"test"` and backend `"test:all"` scripts and documented all test suites and the synthetic-data demonstration notice in `README.md`.

- **Commit**: [`c813a5c`](commit://c813a5c)

---

### Requirement: Readable React Frontend Source & Production Railway Assembly
- **Date**: 2026-11-11
- **Requirement Reference**: *"A deployed React-based frontend"* & *"Start the application using the development scripts defined in the root package.json and the individual workspace configurations"*

#### What I asked for:
> "Replace the prebuilt frontend JS bundles with clean, modular TypeScript React components in `frontend/src/`, assemble the Express backend to serve the compiled SPA, and configure the workspace for Railway deployment."

#### What the tool produced:
Initially, the frontend workspace relied on static compiled JS chunks inside `frontend/public/assets/`, while the backend assumed `VITE` dev proxy for `/api`, lacked `trust proxy` and `Idempotency-Key` CORS header support, omitted `migration_lock.toml`, and did not include `family: 0` for Railway internal Redis resolution.

#### What was wrong with it:
1. **Unreadable Prebuilt Bundles**: Relying on prebuilt JS files meant `frontend/src/` had no inspectable React components that could be maintained or explained in a live code walkthrough.
2. **Production Proxy & CORS Gaps**: Behind Railway's edge proxy, `req.ip` resolved to the proxy IP instead of the client IP (breaking per-IP Redis rate limiting), and CORS omitted `Idempotency-Key` from `allowedHeaders`.
3. **Database & Ledger Contract Bugs**: Missing `migration_lock.toml` breaks `prisma migrate deploy` on fresh PostgreSQL instances, and statement events returned unsigned `amount` instead of signed `amountPaise` (`-` for debits) and `runningBalancePaise`.

#### What I did instead:
- Authored full, typed React 18 modules across `frontend/src/` (`AuthContext.tsx`, `Layout.tsx`, `AuthPage.tsx`, `DashboardPage.tsx`, `AccountsPage.tsx`, `FinancialTransactionPage.tsx`, `LedgerPages.tsx`, `AccountRequestsPage.tsx`, `AdminPages.tsx`, `SettingsPages.tsx`).
- Updated `backend/src/index.ts` to enable `app.set('trust proxy', 1)`, allow `Idempotency-Key` in CORS headers, and serve `frontend/dist` with SPA fallback.
- Added `family: 0` in `backend/src/redis.ts`, added `migration_lock.toml`, aligned transaction/statement response contracts, and configured `railway.toml` + `.railwayignore`.

- **Commit**: [`6f1cda8`](commit://6f1cda8)

---

### Requirement: Production Railway Startup, Idempotent Seeding & Live Verification
- **Date**: 2026-11-11
- **Requirement Reference**: *"Improve deployment monitoring and operational reliability"* & *"Complete browser-based testing of the deployed application"*

#### What I asked for:
> "Deploy the unified React + Express app to Railway with managed PostgreSQL and Redis, run database migrations and admin bootstrap automatically, and verify all APIs and routes against the live public URL."

#### What the tool produced:
1. Initial `railway.toml` placed migrations and seeding inside `preDeployCommand = "npx prisma migrate deploy ... && ..."` as a single TOML string while `auth.ts` lacked `try/catch` wrappers on async Express 4 handlers.
2. Unconditional `db:seed` reset demo balances on every run, and `backend/tests/e2e-browser.test.ts` relied on fixed `sleep(1500)` timeouts between lazy-loaded React routes.

#### What was wrong with it:
1. **Silent Pre-Deploy Miss & Process Crash (`P2021`)**: Railway Config-as-Code requires array syntax for `preDeployCommand`; with a string value, migrations did not run, leaving `public.users` missing at runtime. Calling `POST /api/auth/login` threw Prisma `P2021` without `try/catch`, crashing the Express process with an unhandled promise rejection (`502`).
2. **State Overwrites & Remote Latency Flakiness**: Re-running `seed.ts` unconditionally resets existing account balances, and fixed `1500ms` sleeps fail over remote HTTPS when lazy React chunks and API calls are in flight.

#### What I did instead:
- Replaced the invalid `preDeployCommand` string in `railway.toml` with `startCommand = "npm run start:prod"`, backed by root `start:prod` (`prisma migrate deploy` -> `bootstrap:admin` -> `db:seed -- --if-empty` -> `npm start`).
- Added `--if-empty` to `backend/prisma/seed.ts` and preserved any active bootstrapped administrator account.
- Wrapped `/login`, `/register`, `/accept-invitation`, and `/change-password` async handlers in `backend/src/routes/auth.ts` with `try/catch` forwarding errors to Express's global error handler (`next(err)`).
- Updated `backend/tests/e2e-browser.test.ts` to wait on actual DOM heading/selector readiness (`waitForFunction` / `waitForSelector`) and verified the live deployment (`https://balancevault-app-production.up.railway.app`) with 0 console/page errors.

- **Commit**: [`90eec0d`](commit://90eec0d)

---
