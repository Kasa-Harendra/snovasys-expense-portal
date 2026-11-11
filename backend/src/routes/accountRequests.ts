import { Router, Response } from 'express';
import { prisma } from '../prisma.js';
import { authenticate, AuthenticatedRequest, requireRole } from '../middleware/auth.js';
import { logAuditEvent } from '../middleware/audit.js';
import { Role } from '@prisma/client';

const router = Router();

// 1. User: List own requests
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const requests = await prisma.accountRequest.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  });

  return res.status(200).json({
    requests: requests.map((r) => ({
      ...r,
      reviewNote: r.note,
    })),
  });
});

// 2. User: Submit new request
router.post('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { requestedType = 'PERSONAL' } = req.body;

  const request = await prisma.accountRequest.create({
    data: {
      userId: user.id,
      requestedType: String(requestedType).toUpperCase(),
      status: 'PENDING',
    },
  });

  await logAuditEvent(req, {
    action: 'ACCOUNT_REQUEST_SUBMITTED',
    metadata: { requestId: request.id, requestedType: request.requestedType },
  });

  return res.status(201).json({ request });
});

// 3. Admin: Get approval queue
router.get('/admin/queue', authenticate, requireRole([Role.ADMIN]), async (req: AuthenticatedRequest, res: Response) => {
  const requests = await prisma.accountRequest.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
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

  return res.status(200).json({ requests });
});

// 4. Admin: Approve request
router.post('/admin/:id/approve', authenticate, requireRole([Role.ADMIN]), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { accountNumber } = req.body;

  if (!accountNumber || !String(accountNumber).trim()) {
    return res.status(400).json({ error: 'Account number is required for approval.' });
  }

  const existingRequest = await prisma.accountRequest.findUnique({
    where: { id },
  });

  if (!existingRequest || existingRequest.status !== 'PENDING') {
    return res.status(404).json({ error: 'Pending request not found.' });
  }

  const result = await prisma.$transaction(async (tx) => {
    const updatedRequest = await tx.accountRequest.update({
      where: { id },
      data: { status: 'APPROVED' },
    });

    const newAccount = await tx.account.create({
      data: {
        userId: existingRequest.userId,
        accountNumber: String(accountNumber).trim(),
        type: existingRequest.requestedType,
        currency: 'INR',
        balance: BigInt(0),
        status: 'ACTIVE',
      },
    });

    return { updatedRequest, newAccount };
  });

  await logAuditEvent(req, {
    action: 'ACCOUNT_REQUEST_APPROVED',
    metadata: { requestId: id, accountNumber },
  });

  return res.status(200).json({ message: 'Request approved successfully.', ...result });
});

// 5. Admin: Reject request
router.post('/admin/:id/reject', authenticate, requireRole([Role.ADMIN]), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { note } = req.body;

  const existingRequest = await prisma.accountRequest.findUnique({
    where: { id },
  });

  if (!existingRequest || existingRequest.status !== 'PENDING') {
    return res.status(404).json({ error: 'Pending request not found.' });
  }

  const updatedRequest = await prisma.accountRequest.update({
    where: { id },
    data: {
      status: 'REJECTED',
      note: note || 'Reviewed and rejected by administrator.',
    },
  });

  await logAuditEvent(req, {
    action: 'ACCOUNT_REQUEST_REJECTED',
    metadata: { requestId: id, note },
  });

  return res.status(200).json({ message: 'Request rejected.', request: updatedRequest });
});

export default router;
