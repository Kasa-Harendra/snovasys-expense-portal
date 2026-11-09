import { Router, Request, Response } from 'express';
import { prisma } from '../prisma.js';
import { redis } from '../redis.js';

const router = Router();

router.get('/ready', async (req: Request, res: Response) => {
  try {
    // Check Database
    await prisma.$queryRaw`SELECT 1`;

    // Check Redis (optional check)
    let redisOk = false;
    try {
      if (redis.status === 'ready') {
        const ping = await redis.ping();
        redisOk = ping === 'PONG';
      }
    } catch {
      redisOk = false;
    }

    return res.status(200).json({
      application: 'BalanceVault',
      status: 'ready',
      database: 'connected',
      redis: redisOk ? 'connected' : 'disconnected',
    });
  } catch (err: any) {
    return res.status(503).json({
      application: 'BalanceVault',
      status: 'not_ready',
      error: err.message,
    });
  }
});

router.get('/health', async (req: Request, res: Response) => {
  return res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

export default router;
