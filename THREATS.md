# Threat Model & Security Analysis (THREATS.md)

BalanceVault is a multi-tenant financial ledger and account management system. Because financial ledgers handle critical state transitions and balance integrity, security must be built into every architectural boundary.

This document details our threat landscape, trust boundaries, STRIDE classification, attack vectors, mitigations, and the automated test suites verifying them.

---

## 1. System Architecture & Trust Boundaries

```
[ Public Internet / Untrusted Client ]
              │
              ▼ (TLS / HTTPS)
[ Reverse Proxy / Vite Frontend ]
              │
              ▼ (Strict CORS, Rate Limiting)
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
| **Spoofing** | Forged JWT token, stolen session token, unauthenticated API replay. | Unauthorized impersonation of account holders or administrators. | Cryptographically signed HS256 JWTs with audience (`aud`), issuer (`iss`), expiration (`exp` <= 15m), and active account validation (`isActive`). | `tests/auth.test.ts` |
| **Tampering** | Negative transfer amounts, floating point rounding errors, client-supplied balance values. | Arbitrary balance generation or fraudulent accounting. | Monetary values strictly represented as unsigned 64-bit BigInt paise (`100 paise = ₹1.00`). Client-side balances ignored; all math calculated in DB transactions. | `tests/security.test.ts` |
| **Repudiation** | User denies performing a transfer or admin denies revoking a user. | Lack of accountability, compliance audit failure. | Structured, append-only `audit_logs` table storing actor ID, actor email, IP address, user-agent, action type, and JSON metadata. | `tests/security.test.ts` |
| **Information Disclosure** | IDOR (Insecure Direct Object Reference) accessing other users' accounts or statements. | Data leak of confidential financial transactions. | Strict ownership validation in ORM queries (`where: { id, userId: req.user.id }`). Non-admin attempts return HTTP 403 Forbidden. | `tests/security.test.ts` |
| **Denial of Service** | Credential stuffing on `/api/auth/login`, rapid ledger transfer flooding. | Service unavailability, resource starvation. | Redis sliding-window rate limiting (10 requests per 15 min on login) returning HTTP 429 and IETF `ratelimit` headers. | `tests/security.test.ts` |
| **Elevation of Privilege** | Account holder calling `/api/admin/*` or `/api/audit` endpoints. | Unauthorized user approval, invitation tampering, system takeover. | Role-Based Access Control middleware (`requireRole([Role.ADMIN])`) executed before route handlers. | `tests/security.test.ts` |

---

## 3. High-Priority Vulnerability Mitigations

### 3.1 IDOR Prevention (Insecure Direct Object Reference)
- **Vulnerability**: An attacker changes `accountId` in `GET /api/accounts/:id` or `GET /api/accounts/:id/statement` to view another customer's balance.
- **Defense**: Every query checks `account.userId === req.user.id` unless the requester possesses the `ADMIN` or `AUDITOR` role. Attempting to access another user's account immediately logs an audit violation and rejects with `403 Forbidden`.

### 3.2 Race Conditions & Double-Spend Protection
- **Vulnerability**: Two concurrent transfer requests using the same ₹1,000 balance simultaneously to transfer ₹1,000 twice.
- **Defense**:
  1. Ledger operations execute inside an atomic `prisma.$transaction`.
  2. Account balances are updated with atomic database increments/decrements (`balance: { decrement: amount }`).
  3. Unique client-generated `idempotencyKey` prevents duplicate transaction submissions.

### 3.3 Database Privilege Separation
- **Vulnerability**: SQL injection or compromised application credentials granting administrative database access.
- **Defense**:
  1. Runtime application connects as `balancevault_app`, which only has standard CRUD permissions on public tables.
  2. The admin bootstrap procedure is protected by a PostgreSQL `SECURITY DEFINER` function `admin_bootstrap` granted exclusively to the `bootstrap_operator` role.
  3. Normal application queries cannot alter PostgreSQL user privileges or roles.

### 3.4 Mass Assignment Mitigation
- **Vulnerability**: Attacker injects `"role": "ADMIN"` or `"balance": 999999999` in `POST /api/auth/register` or `PATCH /api/users/me`.
- **Defense**: Strict DTO whitelisting. Registration hardcodes `role: Role.ACCOUNT_HOLDER`. Profile updates only permit mutating `fullName`.

---

## 4. Test Verification Map

All threats documented above are systematically tested in automated test suites:
- **`tests/auth.test.ts`**: Tests invalid credentials, expired tokens, role extraction, and inactive user rejection.
- **`tests/security.test.ts`**: Tests IDOR cross-account access, privilege escalation, negative amounts, double spend prevention, and audit logging.
- **`tests/e2e-browser.test.ts`**: End-to-end browser execution verifying the entire user workflow against the running stack.
