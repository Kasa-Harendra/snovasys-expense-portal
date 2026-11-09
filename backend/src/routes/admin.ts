import { Router, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../prisma.js';
import { authenticate, AuthenticatedRequest, requireRole } from '../middleware/auth.js';
import { logAuditEvent } from '../middleware/audit.js';
import { Role } from '@prisma/client';

const router = Router();

// 1. List users with pagination and filters
router.get('/users', authenticate, requireRole([Role.ADMIN]), async (req: AuthenticatedRequest, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(req.query.perPage) || 50));
  const search = req.query.search ? String(req.query.search).trim() : '';
  const role = req.query.role ? String(req.query.role).toUpperCase() : undefined;
  const status = req.query.status ? String(req.query.status).toLowerCase() : undefined;

  const where: any = {};
  if (search) {
    where.OR = [
      { fullName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (role && (role in Role)) {
    where.role = role as Role;
  }

  if (status === 'active') {
    where.isActive = true;
  } else if (status === 'inactive') {
    where.isActive = false;
  }

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  return res.status(200).json({
    users,
    total,
    page,
    perPage,
  });
});

// 2. Change user status (active/inactive)
router.patch('/users/:id/status', authenticate, requireRole([Role.ADMIN]), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { isActive } = req.body;

  if (typeof isActive !== 'boolean') {
    return res.status(400).json({ error: 'isActive must be a boolean.' });
  }

  const updatedUser = await prisma.user.update({
    where: { id },
    data: { isActive },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      isActive: true,
    },
  });

  await logAuditEvent(req, {
    action: 'USER_STATUS_TOGGLED',
    metadata: { userId: id, isActive },
  });

  return res.status(200).json({ user: updatedUser });
});

// 3. List invitations
router.get('/invitations', authenticate, requireRole([Role.ADMIN]), async (req: AuthenticatedRequest, res: Response) => {
  const invitations = await prisma.invitation.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return res.status(200).json({ invitations });
});

// 4. Create invitation
router.post('/invitations', authenticate, requireRole([Role.ADMIN]), async (req: AuthenticatedRequest, res: Response) => {
  const { fullName, email, role = 'ACCOUNT_HOLDER' } = req.body;

  if (!fullName || !email) {
    return res.status(400).json({ error: 'Full name and email are required.' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 86400000); // 7 days expiration

  const invitation = await prisma.invitation.create({
    data: {
      fullName: String(fullName).trim(),
      email: normalizedEmail,
      role: role as Role,
      token,
      expiresAt,
      status: 'PENDING',
    },
  });

  await logAuditEvent(req, {
    action: 'INVITATION_CREATED',
    metadata: { email: normalizedEmail, role },
  });

  return res.status(201).json({ invitation });
});

// 5. Revoke invitation
router.post('/invitations/:id/revoke', authenticate, requireRole([Role.ADMIN]), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const updatedInvitation = await prisma.invitation.update({
    where: { id },
    data: { status: 'REVOKED' },
  });

  await logAuditEvent(req, {
    action: 'INVITATION_REVOKED',
    metadata: { invitationId: id },
  });

  return res.status(200).json({ invitation: updatedInvitation });
});

export default router;
