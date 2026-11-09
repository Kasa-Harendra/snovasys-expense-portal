import { Router, Response } from 'express';
import { prisma } from '../prisma.js';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.js';
import { logAuditEvent } from '../middleware/audit.js';

const router = Router();

router.get('/me', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  return res.status(200).json({ user });
});

router.patch('/me', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { fullName } = req.body;
  if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
    return res.status(400).json({ error: 'Full name cannot be blank.' });
  }

  const updatedUser = await prisma.user.update({
    where: { id: req.user!.id },
    data: { fullName: fullName.trim() },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await logAuditEvent(req, {
    action: 'USER_PROFILE_UPDATED',
    actorId: updatedUser.id,
    actorEmail: updatedUser.email,
    metadata: { fullName: updatedUser.fullName },
  });

  return res.status(200).json({ user: updatedUser });
});

export default router;
