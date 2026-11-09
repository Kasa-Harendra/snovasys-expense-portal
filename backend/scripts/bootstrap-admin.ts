import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import os from 'os';

const prisma = new PrismaClient();

async function bootstrapAdmin() {
  const args = process.argv.slice(2);
  const getArg = (name: string, defaultVal = '') => {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
  };

  const name = getArg('name', process.env.BOOTSTRAP_ADMIN_NAME || 'Primary Administrator');
  const email = getArg('email', process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@balancevault.internal').toLowerCase().trim();
  const password = getArg('password', process.env.BOOTSTRAP_ADMIN_PASSWORD || 'AdminVault2026!');
  const force = args.includes('--force');

  console.log(`[BOOTSTRAP] Initiating First-Admin Bootstrap for: ${email}`);

  // Validate inputs
  if (!name || !email || !password) {
    console.error('Error: Administrator name, email, and password must be provided.');
    process.exit(1);
  }

  if (password.length < 10) {
    console.error('Error: Bootstrap administrator password must be at least 10 characters.');
    process.exit(1);
  }

  // Check if an active admin already exists
  const existingAdmin = await prisma.user.findFirst({
    where: { role: Role.ADMIN, isActive: true },
  });

  if (existingAdmin && !force) {
    console.warn(`[BOOTSTRAP WARNING] An active administrator (${existingAdmin.email}) already exists.`);
    console.warn('To re-provision or update, run with --force flag.');
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // Attempt using PostgreSQL admin_bootstrap stored function first
  let adminId: string;
  try {
    const result: any = await prisma.$queryRawUnsafe(
      `SELECT admin_bootstrap($1, $2, $3) as id;`,
      name,
      email,
      passwordHash
    );
    adminId = result[0]?.id;
    console.log(`[BOOTSTRAP] Database admin_bootstrap() function executed successfully.`);
  } catch (err: any) {
    console.warn(`[BOOTSTRAP NOTE] Fallback to direct Prisma transaction: ${err.message}`);
    const admin = await prisma.user.upsert({
      where: { email },
      update: {
        fullName: name,
        passwordHash,
        role: Role.ADMIN,
        isActive: true,
      },
      create: {
        fullName: name,
        email,
        passwordHash,
        role: Role.ADMIN,
        isActive: true,
      },
    });
    adminId = admin.id;
  }

  // Create immutable bootstrap audit entry
  await prisma.auditLog.create({
    data: {
      action: 'FIRST_ADMIN_BOOTSTRAPPED',
      actorId: adminId,
      actorEmail: email,
      ip: '127.0.0.1',
      userAgent: `BalanceVault-Operator-CLI (${os.hostname()})`,
      metadata: {
        adminId,
        email,
        bootstrapTimestamp: new Date().toISOString(),
        host: os.hostname(),
        platform: os.platform(),
      },
    },
  });

  console.log(`✓ First-Admin Bootstrap verified and complete.`);
  console.log(`  Admin ID:    ${adminId}`);
  console.log(`  Email:       ${email}`);
  console.log(`  Role:        ADMIN`);
  console.log(`  Audit Log:   FIRST_ADMIN_BOOTSTRAPPED record written.`);
}

bootstrapAdmin()
  .catch((e) => {
    console.error('Bootstrap failure:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
