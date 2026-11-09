import assert from 'assert';
import { prisma } from '../src/prisma.js';
import { Role } from '@prisma/client';

const API_BASE = process.env.TEST_API_URL || 'http://localhost:3000/api';

async function runOnboardingTests() {
  console.log('--- Running Registration & Onboarding End-to-End Tests ---');

  // 1. Ensure backend is running
  try {
    const readyRes = await fetch(`${API_BASE}/ready`);
    assert.strictEqual(readyRes.status, 200, 'Backend /api/ready must be 200');
  } catch (err) {
    console.error('Backend not reachable at', API_BASE);
    process.exit(1);
  }

  // 2. Register new customer
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const testEmail = `applicant_${randomSuffix}@balancevault.test`;
  const testPassword = `Onboard2026!_${randomSuffix}`;
  const testName = `Applicant User ${randomSuffix}`;

  console.log(`Step 1: Registering new account holder (${testEmail})...`);
  const regRes = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: testName, email: testEmail, password: testPassword }),
  });
  assert.strictEqual(regRes.status, 201, `Registration failed with status ${regRes.status}`);
  const regData = await regRes.json();
  assert.ok(regData.accessToken, 'Expected JWT access token');
  assert.strictEqual(regData.user.role, 'ACCOUNT_HOLDER');
  const userToken = regData.accessToken;
  const userId = regData.user.id;
  console.log('✓ Registration succeeded with welcome account and initial balance.');

  // 3. Verify customer default personal account was created
  console.log('Step 2: Verifying initial account creation...');
  const accRes = await fetch(`${API_BASE}/accounts`, {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  assert.strictEqual(accRes.status, 200);
  const accData = await accRes.json();
  assert.ok(Array.isArray(accData.accounts), 'Expected accounts array');
  assert.strictEqual(accData.accounts.length, 1, 'Expected exactly 1 default account');
  console.log(`✓ Initial account confirmed: ${accData.accounts[0].accountNumber}`);

  // 4. Submit an account request for a BUSINESS account
  console.log('Step 3: Submitting an onboarding account request for a BUSINESS account...');
  const reqRes = await fetch(`${API_BASE}/account-requests`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requestedType: 'BUSINESS' }),
  });
  assert.strictEqual(reqRes.status, 201);
  const reqData = await reqRes.json();
  assert.strictEqual(reqData.request.status, 'PENDING');
  assert.strictEqual(reqData.request.requestedType, 'BUSINESS');
  const requestId = reqData.request.id;
  console.log(`✓ Onboarding request submitted (ID: ${requestId}).`);

  // 5. Admin Login & Check Queue
  console.log('Step 4: Admin login and checking onboarding queue...');
  const adminLoginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@balancevault.internal', password: 'AdminVault2026!' }),
  });
  assert.strictEqual(adminLoginRes.status, 200);
  const adminData = await adminLoginRes.json();
  const adminToken = adminData.accessToken;

  const queueRes = await fetch(`${API_BASE}/account-requests/admin/queue`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(queueRes.status, 200);
  const queueData = await queueRes.json();
  const queuedItem = queueData.requests.find((r: any) => r.id === requestId);
  assert.ok(queuedItem, 'Expected submitted request in admin queue');
  console.log('✓ Admin queue inspected and request found.');

  // 6. Admin Approves the Request
  console.log('Step 5: Admin approving request with custom account number...');
  const newAccountNumber = `BV-BIZ-${Math.floor(10000000 + Math.random() * 90000000)}`;
  const approveRes = await fetch(`${API_BASE}/account-requests/admin/${requestId}/approve`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ accountNumber: newAccountNumber }),
  });
  assert.strictEqual(approveRes.status, 200);
  console.log(`✓ Account request approved. New account assigned: ${newAccountNumber}`);

  // 7. Verify Customer Now Has Two Accounts
  console.log('Step 6: Customer verifying account list has newly approved account...');
  const recheckAccRes = await fetch(`${API_BASE}/accounts`, {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  const recheckAccData = await recheckAccRes.json();
  assert.strictEqual(recheckAccData.accounts.length, 2, 'Expected 2 accounts now');
  const bizAcc = recheckAccData.accounts.find((a: any) => a.accountNumber === newAccountNumber);
  assert.ok(bizAcc, 'Expected new business account to be present in user accounts');
  assert.strictEqual(bizAcc.type, 'BUSINESS');
  console.log('✓ End-to-end customer onboarding workflow verified successfully.');

  // 8. Cleanup test user & accounts
  console.log('Step 7: Cleaning up test onboarding records...');
  await prisma.user.delete({ where: { id: userId } });
  console.log('✓ Cleanup complete.');

  console.log('--- ALL ONBOARDING & REGISTRATION TESTS PASSED ---');
}

runOnboardingTests().catch((err) => {
  console.error('Onboarding test error:', err);
  process.exit(1);
});
