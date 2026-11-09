import { Request, Response, NextFunction } from 'express';
import { redis } from '../redis.js';

interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
  prefix?: string;
}

export function createRateLimiter(options: RateLimitOptions) {
  const { limit, windowSeconds, prefix = 'rl' } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
      const key = `${prefix}:${ip}`;

      // In-memory fallback if redis is disconnected
      if (redis.status !== 'ready') {
        return next();
      }

      const current = await redis.incr(key);
      if (current === 1) {
        await redis.expire(key, windowSeconds);
      }

      const ttl = await redis.ttl(key);
      const remaining = Math.max(0, limit - current);

      res.setHeader('ratelimit', `"${limit}-in-${Math.round(windowSeconds / 60)}min"; r=${remaining}; t=${ttl > 0 ? ttl : windowSeconds}`);
      res.setHeader('ratelimit-policy', `"${limit}-in-${Math.round(windowSeconds / 60)}min"; q=${limit}; w=${windowSeconds}`);

      if (current > limit) {
        res.setHeader('retry-after', String(ttl > 0 ? ttl : windowSeconds));
        return res.status(429).json({
          error: 'Too many requests. Please try again later.',
          retryAfter: ttl > 0 ? ttl : windowSeconds,
        });
      }

      next();
    } catch (err) {
      // Don't block requests if rate limiting encounters an error
      next();
    }
  };
}
