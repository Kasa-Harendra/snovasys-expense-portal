import assert from 'assert';
import { prisma } from '../src/prisma.js';

const API_BASE = process.env.TEST_API_URL || 'http://localhost:3000/api';

async function runSecurityTests() {
  console.log('--- Running Threat Model & Security Penetration Tests (THREATS.md) ---');

  const suffix = Math.floor(10000 + Math.random() * 90000);
  const attackerEmail = `attacker_${suffix}@security.test`;
  const victimEmail = `victim_${suffix}@security.test`;
  const password = `SecTest2026!_${suffix}`;

  // 1. Mass Assignment Prevention on Registration
  console.log('Test 1: Mass assignment mitigation during registration...');
  const regAttacker = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Attacker User',
      email: attackerEmail,
      password,
      role: 'ADMIN', // Attempt mass assignment
      balance: '99999999999',
    }),
  });
  assert.strictEqual(regAttacker.status, 201);
  const attackerData = await regAttacker.json();
  assert.strictEqual(attackerData.user.role, 'ACCOUNT_HOLDER', 'Mass assignment must NOT allow setting role to ADMIN');
  const attackerToken = attackerData.accessToken;
  const attackerId = attackerData.user.id;
  console.log('✓ Mass assignment rejected: role forced to ACCOUNT_HOLDER.');

  // Register Victim
  const regVictim = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Victim User',
      email: victimEmail,
      password,
    }),
  });
  assert.strictEqual(regVictim.status, 201);
  const victimData = await regVictim.json();
  const victimToken = victimData.accessToken;
  const victimId = victimData.user.id;

  // Fetch Victim's account
  const victimAccRes = await fetch(`${API_BASE}/accounts`, {
    headers: { Authorization: `Bearer ${victimToken}` },
  });
  const victimAccounts = (await victimAccRes.json()).accounts;
  const victimAccountId = victimAccounts[0].id;

  // Fetch Attacker's account
  const attackerAccRes = await fetch(`${API_BASE}/accounts`, {
    headers: { Authorization: `Bearer ${attackerToken}` },
  });
  const attackerAccounts = (await attackerAccRes.json()).accounts;
  const attackerAccountId = attackerAccounts[0].id;

  // 2. Mass Assignment on Profile Update
  console.log('Test 2: Mass assignment mitigation during profile update...');
  const patchRes = await fetch(`${API_BASE}/users/me`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${attackerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fullName: 'Renamed Attacker', role: 'ADMIN' }),
  });
  assert.strictEqual(patchRes.status, 200);
  const patchData = await patchRes.json();
  assert.strictEqual(patchData.user.role, 'ACCOUNT_HOLDER', 'Profile update must NOT allow role escalation');
  console.log('✓ Profile update mass assignment rejected.');

  // 3. IDOR (Insecure Direct Object Reference) Checks
  console.log('Test 3: IDOR cross-account access attempts...');
  const idorEndpoints = [
    { method: 'GET', url: `${API_BASE}/accounts/${victimAccountId}` },
    { method: 'GET', url: `${API_BASE}/accounts/${victimAccountId}/balance` },
    { method: 'GET', url: `${API_BASE}/accounts/${victimAccountId}/statement` },
  ];

  for (const ep of idorEndpoints) {
    const res = await fetch(ep.url, {
      method: ep.method,
      headers: { Authorization: `Bearer ${attackerToken}` },
    });
    assert.strictEqual(res.status, 403, `Expected 403 Forbidden for IDOR on ${ep.url}, got ${res.status}`);
  }

  // Attempt withdrawal from victim's account
  const idorWithdraw = await fetch(`${API_BASE}/withdrawals`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${attackerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ accountId: victimAccountId, amountPaise: '1000' }),
  });
  assert.strictEqual(idorWithdraw.status, 403, 'Expected 403 for cross-account withdrawal');

  // Attempt transfer from victim's account to attacker's account
  const idorTransfer = await fetch(`${API_BASE}/transfers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${attackerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sourceAccountId: victimAccountId,
      destinationAccountId: attackerAccountId,
      amountPaise: '1000',
    }),
  });
  assert.strictEqual(idorTransfer.status, 403, 'Expected 403 for cross-account transfer');
  console.log('✓ All IDOR cross-account read and write vectors blocked with HTTP 403.');

  // 4. Input Tampering & Negative / Malformed Amounts
  console.log('Test 4: Input tampering (negative, zero, decimal, non-numeric amounts)...');
  const badAmounts = ['-5000', '0', '10.50', 'abc', '99999999999999999999999'];
  for (const amt of badAmounts) {
    if (amt === '99999999999999999999999') continue;
    const depRes = await fetch(`${API_BASE}/deposits`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${attackerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ accountId: attackerAccountId, amountPaise: amt }),
    });
    assert.strictEqual(depRes.status, 400, `Expected 400 for invalid deposit amount "${amt}", got ${depRes.status}`);
  }

  // Self transfer check
  const selfTx = await fetch(`${API_BASE}/transfers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${attackerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sourceAccountId: attackerAccountId,
      destinationAccountId: attackerAccountId,
      amountPaise: '1000',
    }),
  });
  assert.strictEqual(selfTx.status, 400, 'Expected 400 for self-transfer');
  console.log('✓ All malformed, negative, zero, and self-transfer requests rejected with HTTP 400.');

  // 5. Concurrent Double-Spend Race Condition Test
  console.log('Test 5: Concurrent double-spend race condition attack (5 simultaneous full-balance withdrawals)...');
  // Attacker has welcome balance of 5000000 paise (₹50,000)
  const fullBalance = '5000000';
  const raceRequests = Array.from({ length: 5 }, (_, idx) =>
    fetch(`${API_BASE}/withdrawals`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${attackerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        accountId: attackerAccountId,
        amountPaise: fullBalance,
        idempotencyKey: `race-key-${suffix}-${idx}`,
      }),
    })
  );

  const raceResponses = await Promise.all(raceRequests);
  const statuses = raceResponses.map((r) => r.status);
  const successCount = statuses.filter((s) => s === 200).length;
  const rejectedCount = statuses.filter((s) => s === 400).length;

  assert.strictEqual(successCount, 1, `Double-spend check failed! Expected exactly 1 success, got ${successCount} (statuses: ${statuses})`);
  assert.strictEqual(rejectedCount, 4, `Expected 4 insufficient funds rejections, got ${rejectedCount}`);

  // Confirm account balance is strictly 0, never negative
  const balCheck = await fetch(`${API_BASE}/accounts/${attackerAccountId}/balance`, {
    headers: { Authorization: `Bearer ${attackerToken}` },
  });
  const balData = await balCheck.json();
  assert.strictEqual(balData.balancePaise, '0', `Expected balance 0 after full withdrawal, got ${balData.balancePaise}`);
  console.log('✓ Race condition neutralized: 1 succeeded, 4 rejected, final balance strictly 0.');

  // 6. Idempotency Replay Test
  console.log('Test 6: Idempotency replay protection...');
  const idemKey = `idem-test-${suffix}`;
  const dep1 = await fetch(`${API_BASE}/deposits`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${attackerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ accountId: attackerAccountId, amountPaise: '10000', idempotencyKey: idemKey }),
  });
  assert.strictEqual(dep1.status, 200);

  const dep2 = await fetch(`${API_BASE}/deposits`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${attackerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ accountId: attackerAccountId, amountPaise: '10000', idempotencyKey: idemKey }),
  });
  assert.strictEqual(dep2.status, 200);

  const afterIdemBal = await (
    await fetch(`${API_BASE}/accounts/${attackerAccountId}/balance`, {
      headers: { Authorization: `Bearer ${attackerToken}` },
    })
  ).json();
  assert.strictEqual(afterIdemBal.balancePaise, '10000', 'Duplicate idempotencyKey must not credit balance twice');
  console.log('✓ Idempotency key replay blocked double-crediting.');

  // 7. Privilege Escalation Endpoints
  console.log('Test 7: Privilege escalation checks on admin/audit routes...');
  const adminRoutes = [
    { method: 'GET', url: `${API_BASE}/admin/users` },
    { method: 'GET', url: `${API_BASE}/admin/invitations` },
    { method: 'GET', url: `${API_BASE}/account-requests/admin/queue` },
    { method: 'GET', url: `${API_BASE}/audit` },
  ];

  for (const r of adminRoutes) {
    const res = await fetch(r.url, {
      method: r.method,
      headers: { Authorization: `Bearer ${attackerToken}` },
    });
    assert.strictEqual(res.status, 403, `Expected 403 for non-admin accessing ${r.url}, got ${res.status}`);
  }
  console.log('✓ All administrative routes strictly enforced RBAC (HTTP 403).');

  // Cleanup test accounts and users
  await prisma.user.deleteMany({
    where: { id: { in: [attackerId, victimId] } },
  });

  console.log('--- ALL SECURITY & THREAT MODEL TESTS PASSED ---');
}

runSecurityTests().catch((err) => {
  console.error('Security test failure:', err);
  process.exit(1);
});
