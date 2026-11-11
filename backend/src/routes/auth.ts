import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma.js';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { logAuditEvent } from '../middleware/audit.js';
import { Role } from '@prisma/client';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'balancevault_jwt_secret_hackathon_super_secure_key_2026';
const JWT_EXPIRES_IN = Number(process.env.JWT_EXPIRES_IN) || 900;

const loginLimiter = createRateLimiter({
  limit: 10,
  windowSeconds: 900,
  prefix: 'login_limit',
});

function generateToken(user: { id: string; email: string; role: Role }) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      iss: 'balancevault-api',
      aud: 'balancevault-client',
      ver: 0,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// 1. Login
router.post('/login', loginLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const isValidPassword = await bcrypt.compare(String(password), user.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (!user.isActive) {
      return res.status(403).json({
        error: 'Your user account is inactive. Sign in again or contact an administrator.',
        reason: 'account_inactive',
      });
    }

    const token = generateToken(user);

    await logAuditEvent(req as AuthenticatedRequest, {
      action: 'USER_LOGIN',
      actorId: user.id,
      actorEmail: user.email,
      metadata: { role: user.role },
    });

    return res.status(200).json({
      accessToken: token,
      tokenType: 'Bearer',
      expiresIn: JWT_EXPIRES_IN,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    return next(err);
  }
});

// 2. Register
router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      return res.status(409).json({ error: 'An account with this email address already exists.' });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    // Generate unique account number
    const randomSuffix = Math.floor(10000000 + Math.random() * 90000000);
    const accountNumber = `BV-INR-${randomSuffix}`;

    const newUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          fullName: String(name).trim(),
          email: normalizedEmail,
          passwordHash,
          role: Role.ACCOUNT_HOLDER,
          isActive: true,
        },
      });

      const account = await tx.account.create({
        data: {
          userId: user.id,
          accountNumber,
          type: 'PERSONAL',
          currency: 'INR',
          balance: BigInt(5000000), // Complimentary ₹50,000 welcome balance
          status: 'ACTIVE',
        },
      });

      await tx.statementEvent.create({
        data: {
          accountId: account.id,
          type: 'DEPOSIT',
          status: 'POSTED',
          amount: BigInt(5000000),
          runningBalance: BigInt(5000000),
          reference: `WELCOME-${Date.now().toString().slice(-6)}`,
          note: 'Welcome account activation credit',
        },
      });

      return user;
    });

    const token = generateToken(newUser);

    await logAuditEvent(req as AuthenticatedRequest, {
      action: 'USER_REGISTERED',
      actorId: newUser.id,
      actorEmail: newUser.email,
      metadata: { initialAccountNumber: accountNumber },
    });

    return res.status(201).json({
      accessToken: token,
      tokenType: 'Bearer',
      expiresIn: JWT_EXPIRES_IN,
      user: {
        id: newUser.id,
        fullName: newUser.fullName,
        email: newUser.email,
        role: newUser.role,
      },
    });
  } catch (err) {
    return next(err);
  }
});

// 3. Accept Invitation
router.post('/accept-invitation', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password are required.' });
    }

    const invitation = await prisma.invitation.findUnique({
      where: { token: String(token).trim() },
    });

    if (!invitation || invitation.status !== 'PENDING') {
      return res.status(400).json({ error: 'Invalid or already accepted invitation token.' });
    }

    if (invitation.expiresAt < new Date()) {
      return res.status(400).json({ error: 'This invitation has expired.' });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    const user = await prisma.$transaction(async (tx) => {
      let u = await tx.user.findUnique({ where: { email: invitation.email } });
      if (u) {
        u = await tx.user.update({
          where: { id: u.id },
          data: {
            passwordHash,
            fullName: invitation.fullName,
            role: invitation.role,
            isActive: true,
          },
        });
      } else {
        u = await tx.user.create({
          data: {
            fullName: invitation.fullName,
            email: invitation.email,
            passwordHash,
            role: invitation.role,
            isActive: true,
          },
        });

        // If account holder, create initial account
        if (invitation.role === Role.ACCOUNT_HOLDER) {
          const randomSuffix = Math.floor(10000000 + Math.random() * 90000000);
          await tx.account.create({
            data: {
              userId: u.id,
              accountNumber: `BV-INR-${randomSuffix}`,
              type: 'PERSONAL',
              currency: 'INR',
              balance: BigInt(0),
              status: 'ACTIVE',
            },
          });
        }
      }

      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED' },
      });

      return u;
    });

    const accessToken = generateToken(user);

    await logAuditEvent(req as AuthenticatedRequest, {
      action: 'INVITATION_ACCEPTED',
      actorId: user.id,
      actorEmail: user.email,
      metadata: { invitationId: invitation.id },
    });

    return res.status(200).json({
      accessToken,
      tokenType: 'Bearer',
      expiresIn: JWT_EXPIRES_IN,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    return next(err);
  }
});

// 4. Change Password
router.post('/change-password', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required.' });
    }

    if (String(newPassword).length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const isCurrentValid = await bcrypt.compare(String(currentPassword), user.passwordHash);
    if (!isCurrentValid) {
      return res.status(400).json({ error: 'Current password does not match.' });
    }

    const newHash = await bcrypt.hash(String(newPassword), 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });

    await logAuditEvent(req, {
      action: 'PASSWORD_CHANGED',
      actorId: user.id,
      actorEmail: user.email,
    });

    return res.status(200).json({ message: 'Password updated successfully.' });
  } catch (err) {
    return next(err);
  }
});

export default router;
