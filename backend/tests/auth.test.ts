import assert from 'assert';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../src/prisma.js';
import { Role } from '@prisma/client';

const API_BASE = process.env.TEST_API_URL || 'http://localhost:3000/api';
const JWT_SECRET = process.env.JWT_SECRET || 'balancevault_jwt_secret_hackathon_super_secure_key_2026';

async function runAuthTests() {
  console.log('--- Running Authentication & Admin Verification Tests ---');

  // Test 1: Successful Admin Login
  console.log('Test 1: Admin login with correct credentials...');
  const res1 = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@balancevault.internal', password: 'AdminVault2026!' }),
  });
  assert.strictEqual(res1.status, 200, `Expected status 200, got ${res1.status}`);
  const data1 = await res1.json();
  assert.ok(data1.accessToken, 'Expected accessToken in login response');
  assert.strictEqual(data1.user.role, 'ADMIN', 'Expected role to be ADMIN');
  assert.strictEqual(data1.tokenType, 'Bearer');
  console.log('✓ Admin login successful and verified.');

  // Test 2: Admin Login with Wrong Password
  console.log('Test 2: Admin login with incorrect password...');
  const res2 = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@balancevault.internal', password: 'WrongPassword123!' }),
  });
  assert.strictEqual(res2.status, 401, `Expected status 401 for bad password, got ${res2.status}`);
  const data2 = await res2.json();
  assert.strictEqual(data2.error, 'Invalid email or password.');
  console.log('✓ Rejected invalid password without leaking user existence.');

  // Test 3: JWT Signature & Claims Verification
  console.log('Test 3: Verify JWT signature and claims...');
  const decoded = jwt.verify(data1.accessToken, JWT_SECRET) as any;
  assert.strictEqual(decoded.role, 'ADMIN');
  assert.strictEqual(decoded.iss, 'balancevault-api');
  assert.strictEqual(decoded.aud, 'balancevault-client');
  assert.ok(decoded.exp > decoded.iat, 'Token expiration must be in future');
  console.log('✓ JWT claims and cryptographic signature verified.');

  // Test 4: Inactive Account Login Rejection
  console.log('Test 4: Verify inactive user login rejection...');
  const inactiveUserEmail = `inactive-test-${Date.now()}@test.internal`;
  const pwdHash = await bcrypt.hash('TestPass123!', 10);
  const inactiveUser = await prisma.user.create({
    data: {
      fullName: 'Deactivated Test User',
      email: inactiveUserEmail,
      passwordHash: pwdHash,
      role: Role.ACCOUNT_HOLDER,
      isActive: false,
    },
  });

  const res4 = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: inactiveUserEmail, password: 'TestPass123!' }),
  });
  assert.strictEqual(res4.status, 403, `Expected status 403 for inactive user, got ${res4.status}`);
  const data4 = await res4.json();
  assert.strictEqual(data4.reason, 'account_inactive');
  console.log('✓ Inactive account login rejected with HTTP 403.');

  // Cleanup test user
  await prisma.user.delete({ where: { id: inactiveUser.id } });

  // Test 5: Verify Rate Limit Headers
  console.log('Test 5: Verify rate limiting headers...');
  assert.ok(res1.headers.get('ratelimit'), 'Expected ratelimit header to be present');
  assert.ok(res1.headers.get('ratelimit-policy'), 'Expected ratelimit-policy header to be present');
  console.log(`✓ Rate limit headers verified: ${res1.headers.get('ratelimit')}`);

  console.log('--- ALL AUTH & ADMIN VERIFICATION TESTS PASSED ---');
}

runAuthTests().catch((err) => {
  console.error('Auth test failed:', err);
  process.exit(1);
});
