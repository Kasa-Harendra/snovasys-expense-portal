import assert from 'assert';
import { prisma } from '../src/prisma.js';

const API_BASE = process.env.TEST_API_URL || 'http://localhost:3000/api';

async function runAdminTests() {
  console.log('--- Running Admin User Management & Audit Log Tests ---');

  // 1. Admin Login
  console.log('Step 1: Admin login...');
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@balancevault.internal', password: 'AdminVault2026!' }),
  });
  assert.strictEqual(loginRes.status, 200);
  const { accessToken: adminToken } = await loginRes.json();

  // 2. Customer Login (to test non-admin access control)
  console.log('Step 2: Customer login for RBAC boundary checks...');
  const custRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'user@email.com', password: 'User@2026!' }),
  });
  assert.strictEqual(custRes.status, 200);
  const { accessToken: customerToken } = await custRes.json();

  // 3. User Listing & Filtering
  console.log('Step 3: Admin listing users with search filter...');
  const usersRes = await fetch(`${API_BASE}/admin/users?page=1&perPage=10&search=user@email.com`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(usersRes.status, 200);
  const usersData = await usersRes.json();
  assert.ok(usersData.users.length > 0, 'Expected at least 1 user matching user@email.com');
  const targetUser = usersData.users[0];
  console.log(`✓ Admin user query returned user: ${targetUser.email} (Role: ${targetUser.role})`);

  // 4. User Status Modification (Activation Toggle)
  console.log('Step 4: Admin toggling user status...');
  const toggleRes = await fetch(`${API_BASE}/admin/users/${targetUser.id}/status`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ isActive: false }),
  });
  assert.strictEqual(toggleRes.status, 200);
  const toggleData = await toggleRes.json();
  assert.strictEqual(toggleData.user.isActive, false);
  console.log('✓ Successfully toggled user to inactive.');

  // Re-enable user
  await fetch(`${API_BASE}/admin/users/${targetUser.id}/status`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ isActive: true }),
  });
  console.log('✓ Successfully restored user to active state.');

  // 5. Invitation Generation & Revocation
  console.log('Step 5: Admin creating and revoking an invitation...');
  const inviteEmail = `invited_${Date.now()}@balancevault.test`;
  const inviteRes = await fetch(`${API_BASE}/admin/invitations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fullName: 'Prospective Auditor',
      email: inviteEmail,
      role: 'AUDITOR',
    }),
  });
  assert.strictEqual(inviteRes.status, 201);
  const inviteData = await inviteRes.json();
  assert.ok(inviteData.invitation.token, 'Expected invitation token');
  assert.strictEqual(inviteData.invitation.status, 'PENDING');
  const inviteId = inviteData.invitation.id;
  console.log(`✓ Invitation generated with secure token: ${inviteData.invitation.token.slice(0, 12)}...`);

  // Revoke invitation
  const revokeRes = await fetch(`${API_BASE}/admin/invitations/${inviteId}/revoke`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(revokeRes.status, 200);
  const revokeData = await revokeRes.json();
  assert.strictEqual(revokeData.invitation.status, 'REVOKED');
  console.log('✓ Invitation successfully revoked.');

  // 6. Audit Log Access Control Check (Customer calling /api/audit should be rejected)
  console.log('Step 6: Customer attempting to access /api/audit (should be 403 Forbidden)...');
  const forbidRes = await fetch(`${API_BASE}/audit`, {
    headers: { Authorization: `Bearer ${customerToken}` },
  });
  assert.strictEqual(forbidRes.status, 403, 'Customer role must receive 403 Forbidden on audit log');
  console.log('✓ RBAC boundary enforced: Non-admin rejected from audit log.');

  // 7. Admin Accessing Audit Log
  console.log('Step 7: Admin accessing /api/audit...');
  const auditRes = await fetch(`${API_BASE}/audit?page=1&perPage=10`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(auditRes.status, 200);
  const auditData = await auditRes.json();
  assert.ok(Array.isArray(auditData.records), 'Expected records array in audit response');
  assert.ok(auditData.records.length > 0, 'Expected recorded audit entries');
  console.log(`✓ Audit log verified: ${auditData.records.length} records retrieved. Latest action: ${auditData.records[0].action}`);

  // Cleanup invitation
  await prisma.invitation.delete({ where: { id: inviteId } });

  console.log('--- ALL ADMIN USER MANAGEMENT & AUDIT LOG TESTS PASSED ---');
}

runAdminTests().catch((err) => {
  console.error('Admin test error:', err);
  process.exit(1);
});
