import { Router, Request, Response } from 'express';
import { prisma } from '../prisma.js';
import { redis } from '../redis.js';

const router = Router();

router.get('/ready', async (_req: Request, res: Response) => {
  const dbStart = performance.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const dbLatencyMs = Math.round((performance.now() - dbStart) * 100) / 100;

    let redisOk = false;
    let redisLatencyMs: number | null = null;
    try {
      if (redis.status === 'ready') {
        const redisStart = performance.now();
        const ping = await redis.ping();
        redisLatencyMs = Math.round((performance.now() - redisStart) * 100) / 100;
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
      checks: {
        dbLatencyMs,
        redisLatencyMs,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[Readiness Failure]:', err?.message || err);
    return res.status(503).json({
      application: 'BalanceVault',
      status: 'not_ready',
      database: 'disconnected',
      timestamp: new Date().toISOString(),
    });
  }
});

router.get('/health', async (_req: Request, res: Response) => {
  const mem = process.memoryUsage();
  return res.status(200).json({
    application: 'BalanceVault',
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    memory: {
      rssMb: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
      heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
    },
    nodeVersion: process.version,
  });
});

export default router;
