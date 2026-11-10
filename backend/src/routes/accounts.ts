import { Router, Response } from 'express';
import { prisma } from '../prisma.js';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.js';
import { logAuditEvent } from '../middleware/audit.js';
import { Role } from '@prisma/client';

const router = Router();

// 1. List accounts
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const whereClause = user.role === Role.ADMIN ? {} : { userId: user.id };

  const accounts = await prisma.account.findMany({
    where: whereClause,
    orderBy: { createdAt: 'asc' },
    include: {
      user: {
        select: {
          fullName: true,
          email: true,
        },
      },
    },
  });

  return res.status(200).json({
    accounts: accounts.map((acc) => ({
      ...acc,
      currencyCode: acc.currency,
      balancePaise: acc.balance.toString(),
    })),
  });
});

// 2. Get specific account
router.get('/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const user = req.user!;

  const account = await prisma.account.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
        },
      },
    },
  });

  if (!account) {
    return res.status(404).json({ error: 'Account not found.' });
  }

  if (user.role !== Role.ADMIN && account.userId !== user.id) {
    return res.status(403).json({ error: 'You do not have permission to view this account.' });
  }

  return res.status(200).json({
    account: {
      ...account,
      currencyCode: account.currency,
      balancePaise: account.balance.toString(),
    },
  });
});

// 3. Get account balance
router.get('/:id/balance', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const user = req.user!;

  const account = await prisma.account.findUnique({
    where: { id },
    select: { id: true, userId: true, balance: true, currency: true, status: true },
  });

  if (!account) {
    return res.status(404).json({ error: 'Account not found.' });
  }

  if (user.role !== Role.ADMIN && account.userId !== user.id) {
    return res.status(403).json({ error: 'You do not have permission to view this account balance.' });
  }

  return res.status(200).json({
    balancePaise: account.balance.toString(),
    currencyCode: account.currency,
    availableBalancePaise: account.balance.toString(),
  });
});

// 4. Create new account
router.post('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { type = 'PERSONAL', currency = 'INR', initialBalance = '0' } = req.body;

  const randomSuffix = Math.floor(10000000 + Math.random() * 90000000);
  const accountNumber = `BV-INR-${randomSuffix}`;

  const balancePaise = BigInt(initialBalance || 0);

  const account = await prisma.$transaction(async (tx) => {
    const acc = await tx.account.create({
      data: {
        userId: user.id,
        accountNumber,
        type: String(type).toUpperCase(),
        currency,
        balance: balancePaise,
        status: 'ACTIVE',
      },
    });

    if (balancePaise > 0n) {
      await tx.statementEvent.create({
        data: {
          accountId: acc.id,
          type: 'DEPOSIT',
          status: 'POSTED',
          amount: balancePaise,
          runningBalance: balancePaise,
          reference: `INIT-${Date.now().toString().slice(-6)}`,
          note: 'Initial funding',
        },
      });
    }

    return acc;
  });

  await logAuditEvent(req, {
    action: 'ACCOUNT_CREATED',
    metadata: { accountNumber: account.accountNumber, type: account.type },
  });

  return res.status(201).json({
    account: {
      ...account,
      currencyCode: account.currency,
      balancePaise: account.balance.toString(),
    },
  });
});

// 5. Account statement events
router.get('/:id/statement', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const user = req.user!;
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  const account = await prisma.account.findUnique({
    where: { id },
  });

  if (!account) {
    return res.status(404).json({ error: 'Account not found.' });
  }

  if (user.role !== Role.ADMIN && user.role !== Role.AUDITOR && account.userId !== user.id) {
    return res.status(403).json({ error: 'You do not have permission to view this account statement.' });
  }

  const events = await prisma.statementEvent.findMany({
    where: { accountId: id },
    orderBy: { timestamp: 'desc' },
    take: limit,
  });

  return res.status(200).json({
    account: {
      id: account.id,
      accountNumber: account.accountNumber,
      type: account.type,
      currencyCode: account.currency,
      currency: account.currency,
    },
    events: events.map((ev) => ({
      ...ev,
      amountPaise: ev.amount.toString(),
      amount: ev.amount.toString(),
      runningBalance: ev.runningBalance.toString(),
    })),
    hasMore: events.length === limit,
  });
});

export default router;
