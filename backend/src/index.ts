import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import http from 'http';
import path from 'path';
import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import accountsRoutes from './routes/accounts.js';
import transactionsRoutes from './routes/transactions.js';
import accountRequestsRoutes from './routes/accountRequests.js';
import adminRoutes from './routes/admin.js';
import auditRoutes from './routes/audit.js';
import { redis } from './redis.js';
import { prisma } from './prisma.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.set('trust proxy', 1);

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// CORS configuration
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Idempotency-Key'],
  })
);

app.use(express.json({ limit: '256kb' }));

// Request logging in development
if (process.env.NODE_ENV === 'development') {
  app.use((req, _res, next) => {
    console.log(`[API] ${req.method} ${req.url}`);
    next();
  });
}

// API Routes
app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/accounts', accountsRoutes);
app.use('/api', transactionsRoutes);
app.use('/api/account-requests', accountRequestsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/audit', auditRoutes);

// API Fallback 404
app.use('/api/*', (_req, res) => {
  res.status(404).json({ error: 'Endpoint not found.' });
});

// Serve compiled React SPA from frontend/dist in unified/production deployments
const frontendDistPath = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
}

// Error handling middleware
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[API Error]:', err);
  const status = err.status || 500;
  res.status(status).json({
    error: status >= 500 ? 'Internal server error occurred.' : err.message,
  });
});

let server: http.Server;

async function shutdown(signal: string) {
  console.log(`\nReceived ${signal}. Gracefully shutting down BalanceVault API...`);
  if (server) {
    server.close(async () => {
      await prisma.$disconnect().catch(() => {});
      await redis.quit().catch(() => {});
      console.log('✓ Connections closed. Process exiting cleanly.');
      process.exit(0);
    });
  } else {
    await prisma.$disconnect().catch(() => {});
    await redis.quit().catch(() => {});
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function startServer() {
  try {
    await redis.connect().catch((err) => {
      console.warn('Initial Redis connect warning:', err.message);
    });

    server = app.listen(PORT, () => {
      console.log(`✓ BalanceVault Backend API listening on http://localhost:${PORT}`);
      console.log(`✓ Health endpoint: http://localhost:${PORT}/api/ready`);
      if (fs.existsSync(frontendDistPath)) {
        console.log(`✓ Serving React SPA from ${frontendDistPath}`);
      }
    });
  } catch (err) {
    console.error('Fatal server startup error:', err);
    process.exit(1);
  }
}

startServer();
