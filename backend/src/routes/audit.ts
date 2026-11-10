import { Router, Response } from 'express';
import { prisma } from '../prisma.js';
import { authenticate, AuthenticatedRequest, requireRole } from '../middleware/auth.js';
import { Role } from '@prisma/client';

const router = Router();

router.get('/', authenticate, requireRole([Role.ADMIN, Role.AUDITOR]), async (req: AuthenticatedRequest, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(req.query.perPage) || 25));

  const [total, records] = await Promise.all([
    prisma.auditLog.count(),
    prisma.auditLog.findMany({
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { createdAt: 'desc' },
      include: {
        actor: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
          },
        },
      },
    }),
  ]);

  const formattedEvents = records.map((log: any) => {
    const meta = log.metadata || {};
    return {
      id: log.id,
      action: log.action,
      entityType: meta.entityType || log.action.split('_')[0] || 'SYSTEM',
      entityId: meta.entityId || meta.accountId || meta.userId || log.actorId || 'N/A',
      actor: log.actor
        ? {
            id: log.actor.id,
            email: log.actor.email,
            role: log.actor.role,
          }
        : {
            id: log.actorId || 'system',
            email: log.actorEmail || 'system@balancevault.internal',
            role: 'SYSTEM',
          },
      metadata: log.metadata,
      createdAt: log.createdAt,
    };
  });

  return res.status(200).json({
    events: formattedEvents,
    records: formattedEvents,
    total,
    page,
    perPage,
    hasMore: page * perPage < total,
  });
});

export default router;
