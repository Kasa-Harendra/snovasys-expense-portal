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

- **Commit**: Pending Commit — Part 7

---
