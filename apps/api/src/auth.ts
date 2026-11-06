import { Router } from 'express';
import argon2 from 'argon2';
import { z } from 'zod';
import { prisma } from './db.js';
import { createSession, recordAudit, requireAuth, sessionCookie } from './security.js';

export const authRouter = Router();
const loginSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) });
const cookieOptions = {
  httpOnly: true, secure: process.env.COOKIE_SECURE === 'true', sameSite: 'strict' as const,
  path: '/', maxAge: 8 * 60 * 60 * 1000
};

authRouter.post('/login', async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid email or password' });
    const email = parsed.data.email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    const valid = user?.active && await argon2.verify(user.passwordHash, parsed.data.password);
    if (!valid || !user) {
      await recordAudit({ action: 'auth.login_failed', ipAddress: req.ip, metadata: { email } });
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const session = await createSession(user.id, req.get('user-agent')?.slice(0, 500));
    res.cookie(sessionCookie, session.token, cookieOptions);
    await recordAudit({ action: 'auth.login_succeeded', userId: user.id, ipAddress: req.ip });
    return res.json({ user: { id: user.id, email: user.email, displayName: user.displayName } });
  } catch (error) { next(error); }
});

authRouter.post('/logout', requireAuth, async (req, res, next) => {
  try {
    const token = req.cookies?.[sessionCookie];
    if (token) {
      const { createHash } = await import('node:crypto');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      await prisma.userSession.deleteMany({ where: { tokenHash } });
    }
    await recordAudit({ action: 'auth.logout', userId: req.auth!.userId, ipAddress: req.ip });
    res.clearCookie(sessionCookie, { httpOnly: true, secure: cookieOptions.secure, sameSite: 'strict', path: '/' });
    return res.status(204).end();
  } catch (error) { next(error); }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.auth!.userId }, include: { memberships: { include: { company: true, roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } } });
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    return res.json({ id: user.id, email: user.email, displayName: user.displayName,
      companies: user.memberships.map((membership) => ({
        id: membership.company.id, name: membership.company.name,
        roles: membership.roles.map((assignment) => assignment.role.code),
        permissions: [...new Set(membership.roles.flatMap((assignment) => assignment.role.permissions.map((grant) => grant.permission.code)))]
      }))
    });
  } catch (error) { next(error); }
});
