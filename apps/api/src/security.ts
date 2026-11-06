import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from './db.js';

export const sessionCookie = 'vextaone_session';
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

declare global {
  namespace Express {
    interface Request { auth?: { userId: string; email: string; companyIds: string[] }; }
  }
}

export async function createSession(userId: string, userAgent?: string) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  await prisma.userSession.create({ data: { userId, tokenHash: hashToken(token), expiresAt, userAgent } });
  return { token, expiresAt };
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[sessionCookie];
    if (!token || typeof token !== 'string') return res.status(401).json({ error: 'Authentication required' });
    const session = await prisma.userSession.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { include: { memberships: true } } } });
    if (!session || session.expiresAt <= new Date() || !session.user.active) {
      if (session) await prisma.userSession.delete({ where: { id: session.id } });
      res.clearCookie(sessionCookie);
      return res.status(401).json({ error: 'Authentication required' });
    }
    req.auth = { userId: session.user.id, email: session.user.email, companyIds: session.user.memberships.map((m) => m.companyId) };
    next();
  } catch (error) { next(error); }
}

export function requireCompanyAccess(req: Request, res: Response, next: NextFunction) {
  const companyId = req.params.companyId;
  if (!companyId || !req.auth?.companyIds.includes(companyId)) return res.status(404).json({ error: 'Resource not found' });
  next();
}

export function requirePermission(code: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.auth) return res.status(401).json({ error: 'Authentication required' });
      const companyId = req.params.companyId;
      if (companyId && !req.auth.companyIds.includes(companyId)) return res.status(404).json({ error: 'Resource not found' });
      const grant = await prisma.userCompanyRole.findFirst({
        where: { userId: req.auth.userId, ...(companyId ? { companyId } : {}), role: { permissions: { some: { permission: { code } } } } }
      });
      if (!grant) return res.status(403).json({ error: 'Insufficient permission' });
      next();
    } catch (error) { next(error); }
  };
}

export async function recordAudit(input: { action: string; userId?: string; companyId?: string; ipAddress?: string; metadata?: object }) {
  await prisma.auditEvent.create({ data: {
    action: input.action, userId: input.userId, companyId: input.companyId,
    ipAddress: input.ipAddress, metadata: input.metadata ?? {}
  } });
}
