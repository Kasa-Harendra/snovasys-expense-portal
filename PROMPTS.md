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
