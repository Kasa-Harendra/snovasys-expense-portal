import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import accountsRoutes from './routes/accounts.js';
import transactionsRoutes from './routes/transactions.js';
import accountRequestsRoutes from './routes/accountRequests.js';
import adminRoutes from './routes/admin.js';
import auditRoutes from './routes/audit.js';
import { redis } from './redis.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Security and CORS
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  })
);

app.use(express.json());

// Request logging in development
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`[API] ${req.method} ${req.url}`);
    next();
  });
}

// Routes
app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/accounts', accountsRoutes);
app.use('/api', transactionsRoutes);
app.use('/api/account-requests', accountRequestsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/audit', auditRoutes);

// Fallback 404
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found.' });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[API Error]:', err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Internal server error occurred.',
  });
});

async function startServer() {
  try {
    // Attempt Redis connection
    await redis.connect().catch((err) => {
      console.warn('Initial Redis connect warning:', err.message);
    });

    app.listen(PORT, () => {
      console.log(`✓ BalanceVault Backend API listening on http://localhost:${PORT}`);
      console.log(`✓ Health endpoint: http://localhost:${PORT}/api/ready`);
    });
  } catch (err) {
    console.error('Fatal server startup error:', err);
    process.exit(1);
  }
}

startServer();
