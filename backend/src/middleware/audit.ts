import { Request } from 'express';
import { prisma } from '../prisma.js';
import { AuthenticatedRequest } from './auth.js';

interface AuditLogParams {
  action: string;
  actorId?: string;
  actorEmail?: string;
  metadata?: any;
}

export async function logAuditEvent(req: AuthenticatedRequest, params: AuditLogParams) {
  try {
    const ip = (req.headers['x-forwarded-for'] as string) || req.ip || req.socket.remoteAddress || null;
    const userAgent = req.headers['user-agent'] || null;

    await prisma.auditLog.create({
      data: {
        action: params.action,
        actorId: params.actorId || req.user?.id || null,
        actorEmail: params.actorEmail || req.user?.email || null,
        ip: typeof ip === 'string' ? ip.split(',')[0].trim() : null,
        userAgent,
        metadata: params.metadata || {},
      },
    });
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}
