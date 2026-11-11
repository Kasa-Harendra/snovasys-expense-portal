import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6380';

export const redis = new Redis(redisUrl, {
  family: 0, // Support IPv4 and IPv6 internal hostnames (e.g., *.railway.internal)
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 5) return null;
    return Math.min(times * 100, 2000);
  },
  lazyConnect: true,
});

redis.on('error', (err) => {
  console.warn('Redis connection warning:', err.message);
});
