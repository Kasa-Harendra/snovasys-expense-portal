# Threat Model & Security Analysis (THREATS.md)

BalanceVault is a multi-tenant financial ledger and account management system. Because financial ledgers handle critical state transitions and balance integrity, security must be built into every architectural boundary.

This document details our threat landscape, trust boundaries, STRIDE classification, attack vectors, mitigations, and the automated test suites verifying them.

---

## 1. System Architecture & Trust Boundaries

```
[ Public Internet / Untrusted Client ]
              │
              ▼ (TLS / HTTPS)
[ Railway Edge / Express Static SPA & React Frontend ]
              │
              ▼ (CORS, Security Headers, Rate Limiting)
[ Node.js / Express API Boundary ]
   ├── Authentication & JWT Verification (Auth Middleware)
   ├── Role-Based Access Control: RBAC (ADMIN, ACCOUNT_HOLDER, AUDITOR)
   ├── Input Validation & Sanitization (Paise Integer Conversion, Regex)
   └── Rate Limiter (Redis Sliding Window)
              │
              ▼ (Connection Pool / Prisma ORM)
[ PostgreSQL Database Boundary ]
   ├── Custom DB Roles (balancevault_app, bootstrap_operator, balancevault_admin_role)
   ├── Security Definer Functions (admin_bootstrap)
   ├── ACID Transactions (Serializable/Read Committed with FOR UPDATE row locks)
   └── Immutable Audit Trail (audit_logs table)
```

### Trust Zones
1. **Untrusted Zone**: Web browser client, external network inputs, unauthenticated requests.
2. **DMZ / API Perimeter**: Express gateway, Redis rate limiting, reverse proxy headers.
3. **Application Core**: Authenticated JWT context, service logic, financial ledger arithmetic.
4. **Data Persistence Tier**: PostgreSQL engine, database-level role permissions, immutable audit logs.

---

## 2. STRIDE Threat Matrix & Mitigations

| Threat Category | Potential Attack Vector | Impact | Mitigation Strategy | Verified In Test Suite |
| :--- | :--- | :--- | :--- | :--- |
| **Spoofing** | Forged JWT token, stolen session token, unauthenticated API replay. | Unauthorized impersonation of account holders or administrators. | Cryptographically signed HS256 JWTs signed with `iss`, `aud`, short expiry (`exp` <= 15m), signature verification, and live DB `isActive` validation on every request. | `tests/auth.test.ts` |
| **Tampering** | Negative transfer amounts, floating point rounding errors, client-supplied balance values. | Arbitrary balance generation or fraudulent accounting. | Monetary values strictly represented as integer BigInt paise (`100 paise = ₹1.00`) validated with `/^[1-9]\d*$/`. Client balances ignored; arithmetic stays in DB transactions. | `tests/security.test.ts` |
| **Repudiation** | User denies performing a transfer or admin denies revoking a user. | Lack of accountability, compliance audit failure. | Append-only `audit_logs` table storing actor ID, actor email, IP address, user-agent, action type, and JSON metadata. | `tests/security.test.ts` |
| **Information Disclosure** | IDOR (Insecure Direct Object Reference) accessing other users' accounts or statements. | Data leak of confidential financial transactions. | Strict ownership/role checks (`account.userId === req.user.id`, or `ADMIN` — plus `AUDITOR` on statements). Non-authorized requests fail with `HTTP 403 Forbidden` (or `404` when non-existent). | `tests/security.test.ts` |
| **Denial of Service** | Credential stuffing on `/api/auth/login`. | Account brute-forcing and auth endpoint exhaustion. | Redis-backed rate limiting on `/api/auth/login` (`10 requests / 15 min`, proxy-aware via `trust proxy: 1`) returning HTTP 429 and IETF `ratelimit` headers. | `tests/auth.test.ts` |
| **Elevation of Privilege** | Account holder calling `/api/admin/*` or `/api/audit` endpoints. | Unauthorized user approval, invitation tampering, system takeover. | Role-Based Access Control middleware (`requireRole([Role.ADMIN])` / `[Role.ADMIN, Role.AUDITOR]`) executed before route handlers. | `tests/admin.test.ts`, `tests/security.test.ts` |

---

## 3. High-Priority Vulnerability Mitigations

### 3.1 IDOR Prevention (Insecure Direct Object Reference)
- **Vulnerability**: An attacker changes `accountId` in `GET /api/accounts/:id`, `GET /api/accounts/:id/statement`, or financial transaction requests to access or debit another customer's account.
- **Defense**: Every endpoint validates account existence (`404 Account not found`) and verifies `account.userId === req.user.id` unless explicitly permitted (`ADMIN` for account reads; `ADMIN` or `AUDITOR` for `/statement`). Unauthorized deposit/withdrawal/transfer attempts return `403 Forbidden` and write an audit event (`UNAUTHORIZED_DEPOSIT_ATTEMPT`, `UNAUTHORIZED_WITHDRAWAL_ATTEMPT`, `UNAUTHORIZED_TRANSFER_ATTEMPT`).

### 3.2 Race Conditions & Double-Spend Protection
- **Vulnerability**: Two concurrent transfer or withdrawal requests using the same ₹1,000 balance attempt to spend ₹1,000 twice.
- **Defense**:
  1. Ledger operations execute inside an atomic `prisma.$transaction`.
  2. Source account balances are debited with an atomic conditional update (`tx.account.updateMany({ where: { id, balance: { gte: amount }, status: 'ACTIVE' }, data: { balance: { decrement: amount } } })`) rather than a read-then-write check.
  3. Unique `idempotencyKey` (`Idempotency-Key` header or body field) prevents duplicate transaction processing (`409 Conflict` on conflicting replay).

### 3.3 Database Privilege Separation
- **Vulnerability**: Compromised runtime database access granting administrative database privileges.
- **Defense**:
  1. Migration `0_init` defines separate database roles (`balancevault_app`, `bootstrap_operator`, `balancevault_admin_role`) with DML-only grants on `public` tables for `balancevault_app`.
  2. The admin bootstrap procedure is encapsulated in the PostgreSQL `SECURITY DEFINER` function `admin_bootstrap(...)`, granted exclusively to `bootstrap_operator`.
  3. *(Hardening note: In Railway managed PostgreSQL, the default connection string authenticates as the database owner role; production deployments can enforce `SET ROLE balancevault_app` per runtime connection pool.)*

### 3.4 Mass Assignment Mitigation
- **Vulnerability**: Attacker injects `"role": "ADMIN"` or `"balance": 999999999` in `POST /api/auth/register` or `PATCH /api/users/me`.
- **Defense**: Strict DTO whitelisting. Registration hardcodes `role: Role.ACCOUNT_HOLDER`. Profile updates only permit mutating `fullName`.

---

## 4. Test Verification Map

All threats documented above are systematically tested in automated test suites:
- **`tests/auth.test.ts`**: Tests invalid credentials, expired tokens, role extraction, and inactive user rejection.
- **`tests/security.test.ts`**: Tests IDOR cross-account access, privilege escalation, negative amounts, double spend prevention, and audit logging.
- **`tests/e2e-browser.test.ts`**: End-to-end browser execution verifying the entire user workflow against the running stack.
