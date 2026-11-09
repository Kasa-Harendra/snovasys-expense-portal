# AI Interaction Log (PROMPTS.md)

This log documents interactions with AI tools during the development of BalanceVault. Each entry records the prompt, the tool's output, what was incorrect or flawed, what was done instead, and the corresponding commit reference.

---

### Entry 1 — 2026-11-07: PostgreSQL Role Separation & Admin Bootstrap

- **What I asked for**:
  "Generate a PostgreSQL script to create separate roles for our application and allow a migration runner to create the first admin user with elevated privileges."

- **What the tool produced**:
  The AI suggested running `ALTER ROLE admin WITH SUPERUSER;` and executing `ALTER ROLE postgres WITH PASSWORD '...'` through a standard project-owner connection in Neon.

- **What was wrong with it**:
  In managed cloud PostgreSQL environments like Neon and Supabase, project-owner roles do not have superuser privileges. Executing `ALTER ROLE` resulted in `SQLSTATE 42501 (insufficient privilege)`. Giving the runtime web application superuser rights is also a severe security anti-pattern that violates the principle of least privilege.

- **What I did instead**:
  Created distinct database roles (`balancevault_app`, `bootstrap_operator`, `balancevault_admin_role`). Encapsulated the administrator bootstrap logic inside a PostgreSQL `SECURITY DEFINER` function `admin_bootstrap()`, granting execution permission solely to `bootstrap_operator`. Runtime queries run as `balancevault_app` with restricted table-level DML privileges.

- **Commit reference**: [Initial setup and schema definition](commit://c89438a)

---

### Entry 3 — 2026-11-09: First-Admin Bootstrap Process & Operator Security

- **What I asked for**:
  "Create a bootstrap script to initialize the first administrator in production without exposing plain-text credentials in application logs or code."

- **What the tool produced**:
  The AI suggested hardcoding an admin seed user in a public migration script or creating a public unauthenticated `/api/bootstrap` HTTP endpoint that any visitor could trigger once on a first-come, first-served basis.

- **What was wrong with it**:
  A public bootstrap endpoint exposes a critical race condition where an external attacker or automated bot can hit the URL immediately after deployment and claim root administrative ownership of the financial vault. Hardcoding credentials in migration files also commits secrets to version control.

- **What I did instead**:
  Built an out-of-band operator CLI (`backend/scripts/bootstrap-admin.ts`) that executes with elevated local privileges. It verifies active admin state, calls the PostgreSQL `admin_bootstrap()` security definer function, hashes passwords using bcrypt with salt rounds 12, and immediately writes a structured `FIRST_ADMIN_BOOTSTRAPPED` audit log record capturing host and actor metadata.

- **Commit reference**: [feat: implement secure first-admin bootstrap process](commit://68880f8)

---

### Entry 4 — 2026-11-09: Admin Authentication, Token Claims & User Deactivation

- **What I asked for**:
  "Write an automated test script to verify admin login and ensure deactivated users cannot access the API even if they know the password."

- **What the tool produced**:
  The AI wrote a test checking only that a JWT token string was returned, without asserting token structure, claims (`sub`, `role`, `iss`, `aud`), or expiration bounds. For deactivation, it suggested checking `user.isActive` in client-side state after login.

- **What was wrong with it**:
  Client-side checking of account status is completely ineffective against API-level attacks. If an administrator disables a rogue user account, the API must reject login immediately with HTTP 403 `account_inactive` and disallow token generation. Furthermore, tests must cryptographically verify that JWT claims encode the correct RBAC role (`ADMIN`).

- **What I did instead**:
  Implemented server-side enforcement where the authentication controller checks `user.isActive` prior to issuing tokens. Added a comprehensive test suite (`backend/tests/auth.test.ts`) that verifies successful admin login, invalid password error handling (preventing enumeration), JWT cryptographic signature and claim verification, inactive account rejection with HTTP 403, and Redis sliding-window rate limit headers.

- **Commit reference**: [test: add automated authentication test suite](commit://91f1ff6)

---

### Entry 5 — 2026-11-09: End-to-End Registration & Account Onboarding Workflow

- **What I asked for**:
  "Implement and test the customer registration and onboarding flow where a user registers, receives an initial personal account, requests an additional business account, and the admin approves it."

- **What the tool produced**:
  The AI produced a single-step mock function that inserted a new account directly without enforcing the pending request lifecycle, approval queues, or transactional atomicity.

- **What was wrong with it**:
  In a regulated banking ledger, accounts cannot simply appear without an audited state transition. The customer must submit an `AccountRequest` with `status: 'PENDING'`. An administrator must inspect the queue, approve or reject the request, specify the unique account number, and atomically provision the account record within a database transaction.

- **What I did instead**:
  Built complete lifecycle endpoints: `POST /api/account-requests` to create requests, `GET /api/account-requests/admin/queue` for admin review, and `POST /api/account-requests/admin/:id/approve` executed inside a PostgreSQL transaction (`prisma.$transaction`). Created an end-to-end integration test (`backend/tests/onboarding.test.ts`) that verifies the complete lifecycle from registration to approval and balance inspection.

- **Commit reference**: [Pending Commit - Part 4]

---

### Entry 2 — 2026-11-08: Access Control & IDOR Prevention on Account Statements

- **What I asked for**:
  "Write an Express endpoint to return statements for a specific account: `GET /api/accounts/:id/statement`."

- **What the tool produced**:
  The AI generated a handler that read `req.params.id` and directly called `prisma.statementEvent.findMany({ where: { accountId: req.params.id } })`.

- **What was wrong with it**:
  This was vulnerable to Insecure Direct Object Reference (IDOR). Any authenticated account holder could supply another user's account ID in the URL and inspect their entire transaction ledger, balances, and counterparties without any permission check.

- **What I did instead**:
  Implemented ownership validation before querying statements. The endpoint queries the parent account record to check `account.userId === req.user.id`. If the requester is not the account owner and does not hold an `ADMIN` or `AUDITOR` role, the server immediately denies access with `403 Forbidden` and logs an unauthorized access attempt to `audit_logs`.

- **Commit reference**: [Initial setup and schema definition](commit://c89438a)

---

### Entry 3 — 2026-11-09: First-Admin Bootstrap Process & Operator Security

- **What I asked for**:
  "Create a bootstrap script to initialize the first administrator in production without exposing plain-text credentials in application logs or code."

- **What the tool produced**:
  The AI suggested hardcoding an admin seed user in a public migration script or creating a public unauthenticated `/api/bootstrap` HTTP endpoint that any visitor could trigger once on a first-come, first-served basis.

- **What was wrong with it**:
  A public bootstrap endpoint exposes a critical race condition where an external attacker or automated bot can hit the URL immediately after deployment and claim root administrative ownership of the financial vault. Hardcoding credentials in migration files also commits secrets to version control.

- **What I did instead**:
  Built an out-of-band operator CLI (`backend/scripts/bootstrap-admin.ts`) that executes with elevated local privileges. It verifies active admin state, calls the PostgreSQL `admin_bootstrap()` security definer function, hashes passwords using bcrypt with salt rounds 12, and immediately writes a structured `FIRST_ADMIN_BOOTSTRAPPED` audit log record capturing host and actor metadata.

- **Commit reference**: [feat: implement secure first-admin bootstrap process](commit://68880f8)

---

### Entry 4 — 2026-11-09: Admin Authentication, Token Claims & User Deactivation

- **What I asked for**:
  "Write an automated test script to verify admin login and ensure deactivated users cannot access the API even if they know the password."

- **What the tool produced**:
  The AI wrote a test checking only that a JWT token string was returned, without asserting token structure, claims (`sub`, `role`, `iss`, `aud`), or expiration bounds. For deactivation, it suggested checking `user.isActive` in client-side state after login.

- **What was wrong with it**:
  Client-side checking of account status is completely ineffective against API-level attacks. If an administrator disables a rogue user account, the API must reject login immediately with HTTP 403 `account_inactive` and disallow token generation. Furthermore, tests must cryptographically verify that JWT claims encode the correct RBAC role (`ADMIN`).

- **What I did instead**:
  Implemented server-side enforcement where the authentication controller checks `user.isActive` prior to issuing tokens. Added a comprehensive test suite (`backend/tests/auth.test.ts`) that verifies successful admin login, invalid password error handling (preventing enumeration), JWT cryptographic signature and claim verification, inactive account rejection with HTTP 403, and Redis sliding-window rate limit headers.

- **Commit reference**: [test: add automated authentication test suite](commit://91f1ff6)

---

### Entry 5 — 2026-11-09: End-to-End Registration & Account Onboarding Workflow

- **What I asked for**:
  "Implement and test the customer registration and onboarding flow where a user registers, receives an initial personal account, requests an additional business account, and the admin approves it."

- **What the tool produced**:
  The AI produced a single-step mock function that inserted a new account directly without enforcing the pending request lifecycle, approval queues, or transactional atomicity.

- **What was wrong with it**:
  In a regulated banking ledger, accounts cannot simply appear without an audited state transition. The customer must submit an `AccountRequest` with `status: 'PENDING'`. An administrator must inspect the queue, approve or reject the request, specify the unique account number, and atomically provision the account record within a database transaction.

- **What I did instead**:
  Built complete lifecycle endpoints: `POST /api/account-requests` to create requests, `GET /api/account-requests/admin/queue` for admin review, and `POST /api/account-requests/admin/:id/approve` executed inside a PostgreSQL transaction (`prisma.$transaction`). Created an end-to-end integration test (`backend/tests/onboarding.test.ts`) that verifies the complete lifecycle from registration to approval and balance inspection.

- **Commit reference**: [Pending Commit - Part 4]

---
