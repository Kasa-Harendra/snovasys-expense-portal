import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding BalanceVault database...');

  // 1. Primary User: KASA HARENDRA
  const userPasswordHash = await bcrypt.hash('KH20057v@balancev', 10);
  const user = await prisma.user.upsert({
    where: { email: 'harendrakasa@gmail.com' },
    update: {
      fullName: 'KASA HARENDRA',
      passwordHash: userPasswordHash,
      role: Role.ACCOUNT_HOLDER,
      isActive: true,
    },
    create: {
      id: '140b271c-8257-4e73-a507-efdc748c0f4a',
      fullName: 'KASA HARENDRA',
      email: 'harendrakasa@gmail.com',
      passwordHash: userPasswordHash,
      role: Role.ACCOUNT_HOLDER,
      isActive: true,
    },
  });
  console.log(`User created/updated: ${user.email} (${user.id})`);

  // 2. Primary User Accounts
  const account1 = await prisma.account.upsert({
    where: { accountNumber: 'BV-INR-10029481' },
    update: {
      userId: user.id,
      balance: BigInt(25000000), // ₹2,50,000.00
      status: 'ACTIVE',
    },
    create: {
      id: 'acc-140b-01',
      userId: user.id,
      accountNumber: 'BV-INR-10029481',
      type: 'PERSONAL',
      currency: 'INR',
      balance: BigInt(25000000),
      status: 'ACTIVE',
    },
  });

  const account2 = await prisma.account.upsert({
    where: { accountNumber: 'BV-INR-10029482' },
    update: {
      userId: user.id,
      balance: BigInt(7500000), // ₹75,000.00
      status: 'ACTIVE',
    },
    create: {
      id: 'acc-140b-02',
      userId: user.id,
      accountNumber: 'BV-INR-10029482',
      type: 'SAVINGS',
      currency: 'INR',
      balance: BigInt(7500000),
      status: 'ACTIVE',
    },
  });
  console.log(`Accounts verified for user: ${account1.accountNumber}, ${account2.accountNumber}`);

  // 3. Statement Events for Account 1
  const existingEvents = await prisma.statementEvent.count({ where: { accountId: account1.id } });
  if (existingEvents === 0) {
    await prisma.statementEvent.createMany({
      data: [
        {
          accountId: account1.id,
          type: 'DEPOSIT',
          status: 'POSTED',
          amount: BigInt(20000000), // ₹2,00,000.00
          runningBalance: BigInt(20000000),
          reference: 'DEP-20261101-01',
          note: 'Initial account activation deposit',
          timestamp: new Date(Date.now() - 7 * 86400000),
        },
        {
          accountId: account1.id,
          type: 'DEPOSIT',
          status: 'POSTED',
          amount: BigInt(6000000), // ₹60,000.00
          runningBalance: BigInt(26000000),
          reference: 'DEP-20261105-02',
          note: 'Vendor settlement payout',
          timestamp: new Date(Date.now() - 3 * 86400000),
        },
        {
          accountId: account1.id,
          type: 'WITHDRAWAL',
          status: 'POSTED',
          amount: BigInt(1000000), // ₹10,000.00
          runningBalance: BigInt(25000000),
          reference: 'WTH-20261108-01',
          note: 'ATM cash withdrawal',
          timestamp: new Date(Date.now() - 86400000),
        },
      ],
    });
    console.log('Seeded statement events for account 1.');
  }

  // 4. Admin User
  const adminPasswordHash = await bcrypt.hash('AdminVault2026!', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@balancevault.internal' },
    update: {
      fullName: 'System Administrator',
      passwordHash: adminPasswordHash,
      role: Role.ADMIN,
      isActive: true,
    },
    create: {
      fullName: 'System Administrator',
      email: 'admin@balancevault.internal',
      passwordHash: adminPasswordHash,
      role: Role.ADMIN,
      isActive: true,
    },
  });
  console.log(`Admin user ready: ${admin.email}`);

  // 5. Auditor User
  const auditorPasswordHash = await bcrypt.hash('AuditorVault2026!', 10);
  await prisma.user.upsert({
    where: { email: 'auditor@balancevault.internal' },
    update: {
      fullName: 'Compliance Auditor',
      passwordHash: auditorPasswordHash,
      role: Role.AUDITOR,
      isActive: true,
    },
    create: {
      fullName: 'Compliance Auditor',
      email: 'auditor@balancevault.internal',
      passwordHash: auditorPasswordHash,
      role: Role.AUDITOR,
      isActive: true,
    },
  });

  // 6. Account Request Queue (Sample)
  const existingReqs = await prisma.accountRequest.count();
  if (existingReqs === 0) {
    await prisma.accountRequest.create({
      data: {
        userId: user.id,
        requestedType: 'BUSINESS',
        status: 'PENDING',
        note: 'Requesting a corporate checking account for trading ledger operations',
      },
    });
  }

  // 7. Initial Audit Log Entry
  const existingAudit = await prisma.auditLog.count();
  if (existingAudit === 0) {
    await prisma.auditLog.createMany({
      data: [
        {
          action: 'SYSTEM_BOOTSTRAP',
          actorId: admin.id,
          actorEmail: admin.email,
          ip: '127.0.0.1',
          userAgent: 'BalanceVault-Bootstrap-Agent',
          metadata: { note: 'Initial schema and roles initialized' },
        },
        {
          action: 'USER_REGISTERED',
          actorId: user.id,
          actorEmail: user.email,
          ip: '127.0.0.1',
          userAgent: 'Chrome/131.0.0.0',
          metadata: { role: 'ACCOUNT_HOLDER' },
        },
      ],
    });
  }

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
