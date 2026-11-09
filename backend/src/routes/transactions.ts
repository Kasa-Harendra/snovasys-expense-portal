import { Router, Response } from 'express';
import { prisma } from '../prisma.js';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.js';
import { logAuditEvent } from '../middleware/audit.js';
import { Role } from '@prisma/client';

const router = Router();

// 1. Deposits
router.post('/deposits', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { accountId, amountPaise, idempotencyKey, note } = req.body;
  const user = req.user!;

  if (!accountId || !amountPaise) {
    return res.status(400).json({ error: 'Account ID and amount in paise are required.' });
  }

  const amount = BigInt(amountPaise);
  if (amount <= 0n) {
    return res.status(400).json({ error: 'Deposit amount must be greater than zero.' });
  }

  // Check account
  const account = await prisma.account.findUnique({
    where: { id: accountId },
  });

  if (!account) {
    return res.status(404).json({ error: 'Account not found.', reason: 'account_unavailable' });
  }

  if (user.role !== Role.ADMIN && account.userId !== user.id) {
    return res.status(403).json({ error: 'You do not have permission to deposit to this account.', reason: 'not_authorized' });
  }

  if (account.status !== 'ACTIVE') {
    return res.status(400).json({ error: 'Account is not active.', reason: 'account_unavailable' });
  }

  // Idempotency check
  if (idempotencyKey) {
    const existing = await prisma.transfer.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      return res.status(200).json({ message: 'Transaction already processed.', transfer: existing });
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const updatedAccount = await tx.account.update({
      where: { id: account.id },
      data: {
        balance: { increment: amount },
      },
    });

    const ref = `DEP-${Date.now().toString().slice(-8)}`;

    const event = await tx.statementEvent.create({
      data: {
        accountId: account.id,
        type: 'DEPOSIT',
        status: 'POSTED',
        amount,
        runningBalance: updatedAccount.balance,
        reference: ref,
        note: note || 'Funds deposit',
      },
    });

    const transfer = await tx.transfer.create({
      data: {
        destinationAccountId: account.id,
        destinationAccountNumber: account.accountNumber,
        amountPaise: amount,
        currency: account.currency,
        status: 'POSTED',
        idempotencyKey: idempotencyKey || null,
        note: note || 'Deposit',
      },
    });

    return { updatedAccount, event, transfer };
  });

  await logAuditEvent(req, {
    action: 'DEPOSIT_PROCESSED',
    metadata: { accountId, amountPaise: amount.toString() },
  });

  return res.status(200).json({
    message: 'Deposit successful.',
    account: result.updatedAccount,
    transfer: result.transfer,
  });
});

// 2. Withdrawals
router.post('/withdrawals', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { accountId, amountPaise, idempotencyKey, note } = req.body;
  const user = req.user!;

  if (!accountId || !amountPaise) {
    return res.status(400).json({ error: 'Account ID and amount are required.' });
  }

  const amount = BigInt(amountPaise);
  if (amount <= 0n) {
    return res.status(400).json({ error: 'Withdrawal amount must be greater than zero.' });
  }

  const account = await prisma.account.findUnique({
    where: { id: accountId },
  });

  if (!account) {
    return res.status(404).json({ error: 'Account not found.', reason: 'account_unavailable' });
  }

  if (user.role !== Role.ADMIN && account.userId !== user.id) {
    return res.status(403).json({ error: 'You do not have permission to withdraw from this account.', reason: 'not_authorized' });
  }

  if (account.status !== 'ACTIVE') {
    return res.status(400).json({ error: 'Account is not active.', reason: 'account_unavailable' });
  }

  if (account.balance < amount) {
    // Record refused statement event for auditability
    await prisma.statementEvent.create({
      data: {
        accountId: account.id,
        type: 'WITHDRAWAL',
        status: 'REFUSED',
        amount,
        runningBalance: account.balance,
        reference: `REJ-${Date.now().toString().slice(-8)}`,
        note: 'Withdrawal refused: insufficient available balance',
      },
    });

    return res.status(400).json({
      error: 'The account does not have enough available funds for this withdrawal.',
      reason: 'insufficient_funds',
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    const updatedAccount = await tx.account.update({
      where: { id: account.id },
      data: {
        balance: { decrement: amount },
      },
    });

    const ref = `WTH-${Date.now().toString().slice(-8)}`;

    const event = await tx.statementEvent.create({
      data: {
        accountId: account.id,
        type: 'WITHDRAWAL',
        status: 'POSTED',
        amount,
        runningBalance: updatedAccount.balance,
        reference: ref,
        note: note || 'Funds withdrawal',
      },
    });

    const transfer = await tx.transfer.create({
      data: {
        sourceAccountId: account.id,
        amountPaise: amount,
        currency: account.currency,
        status: 'POSTED',
        idempotencyKey: idempotencyKey || null,
        note: note || 'Withdrawal',
      },
    });

    return { updatedAccount, event, transfer };
  });

  await logAuditEvent(req, {
    action: 'WITHDRAWAL_PROCESSED',
    metadata: { accountId, amountPaise: amount.toString() },
  });

  return res.status(200).json({
    message: 'Withdrawal successful.',
    account: result.updatedAccount,
    transfer: result.transfer,
  });
});

// 3. Transfers
router.post('/transfers', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { sourceAccountId, destinationAccountId, amountPaise, idempotencyKey, note } = req.body;
  const user = req.user!;

  if (!sourceAccountId || !destinationAccountId || !amountPaise) {
    return res.status(400).json({ error: 'Source, destination, and amount are required.' });
  }

  if (sourceAccountId === destinationAccountId) {
    return res.status(400).json({ error: 'Source and destination accounts must be different.', reason: 'invalid_accounts' });
  }

  const amount = BigInt(amountPaise);
  if (amount <= 0n) {
    return res.status(400).json({ error: 'Transfer amount must be greater than zero.' });
  }

  const [source, destination] = await Promise.all([
    prisma.account.findUnique({ where: { id: sourceAccountId } }),
    prisma.account.findUnique({ where: { id: destinationAccountId } }),
  ]);

  if (!source || !destination) {
    return res.status(404).json({ error: 'One or both accounts were not found.', reason: 'account_unavailable' });
  }

  if (user.role !== Role.ADMIN && source.userId !== user.id) {
    return res.status(403).json({ error: 'You do not have permission to transfer from this account.', reason: 'not_authorized' });
  }

  if (source.status !== 'ACTIVE' || destination.status !== 'ACTIVE') {
    return res.status(400).json({ error: 'One of the accounts is not active.', reason: 'account_unavailable' });
  }

  if (source.balance < amount) {
    await prisma.statementEvent.create({
      data: {
        accountId: source.id,
        type: 'TRANSFER',
        status: 'REFUSED',
        amount,
        runningBalance: source.balance,
        reference: `REJ-${Date.now().toString().slice(-8)}`,
        note: `Transfer to ${destination.accountNumber} refused: insufficient funds`,
      },
    });

    return res.status(400).json({
      error: 'The account does not have enough available funds for this transfer.',
      reason: 'insufficient_funds',
    });
  }

  // Idempotency check
  if (idempotencyKey) {
    const existing = await prisma.transfer.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      return res.status(200).json({ message: 'Transfer already completed.', transfer: existing });
    }
  }

  const ref = `TRF-${Date.now().toString().slice(-8)}`;

  const result = await prisma.$transaction(async (tx) => {
    const updatedSource = await tx.account.update({
      where: { id: source.id },
      data: { balance: { decrement: amount } },
    });

    const updatedDestination = await tx.account.update({
      where: { id: destination.id },
      data: { balance: { increment: amount } },
    });

    await tx.statementEvent.create({
      data: {
        accountId: source.id,
        type: 'TRANSFER',
        status: 'POSTED',
        amount,
        runningBalance: updatedSource.balance,
        reference: ref,
        note: note ? `${note} (to ${destination.accountNumber})` : `Transfer to ${destination.accountNumber}`,
      },
    });

    await tx.statementEvent.create({
      data: {
        accountId: destination.id,
        type: 'TRANSFER',
        status: 'POSTED',
        amount,
        runningBalance: updatedDestination.balance,
        reference: ref,
        note: note ? `${note} (from ${source.accountNumber})` : `Transfer from ${source.accountNumber}`,
      },
    });

    const transfer = await tx.transfer.create({
      data: {
        sourceAccountId: source.id,
        destinationAccountId: destination.id,
        destinationAccountNumber: destination.accountNumber,
        amountPaise: amount,
        currency: source.currency,
        status: 'POSTED',
        idempotencyKey: idempotencyKey || null,
        note: note || 'Account transfer',
      },
    });

    return { updatedSource, updatedDestination, transfer };
  });

  await logAuditEvent(req, {
    action: 'TRANSFER_COMPLETED',
    metadata: {
      transferId: result.transfer.id,
      from: source.accountNumber,
      to: destination.accountNumber,
      amountPaise: amount.toString(),
    },
  });

  return res.status(200).json({
    message: 'Transfer completed successfully.',
    transfer: result.transfer,
  });
});

// 4. Get Transfer by ID
router.get('/transfers/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const transfer = await prisma.transfer.findUnique({
    where: { id },
  });

  if (!transfer) {
    return res.status(404).json({ error: 'Transfer not found.' });
  }

  return res.status(200).json({
    transfer: {
      ...transfer,
      amountPaise: transfer.amountPaise.toString(),
      entries: [
        {
          id: `leg-${transfer.id}-1`,
          accountNumber: transfer.sourceAccountId ? 'Source' : 'External',
          direction: 'DEBIT',
          amountPaise: transfer.amountPaise.toString(),
        },
        {
          id: `leg-${transfer.id}-2`,
          accountNumber: transfer.destinationAccountNumber || 'Destination',
          direction: 'CREDIT',
          amountPaise: transfer.amountPaise.toString(),
        },
      ],
    },
  });
});

export default router;
