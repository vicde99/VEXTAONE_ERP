import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { authRouter } from './auth.js';
import { prisma } from './db.js';
import { requireAuth, requireCompanyAccess, requirePermission } from './security.js';

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: process.env.APP_ORIGIN, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin') ?? req.get('referer');
  if (!process.env.APP_ORIGIN || !origin || !origin.startsWith(process.env.APP_ORIGIN)) return res.status(403).json({ error: 'Untrusted request origin' });
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth', authRouter);
app.get('/api/companies', requireAuth, async (req, res, next) => {
  try {
    const companies = await prisma.company.findMany({ where: { id: { in: req.auth!.companyIds }, active: true }, select: { id: true, name: true, legalName: true, baseCurrency: true } });
    res.json(companies);
  } catch (error) { next(error); }
});
app.get('/api/companies/:companyId/accounts', requireAuth, requireCompanyAccess, requirePermission('account.read'), async (req, res, next) => {
  try {
    const accounts = await prisma.account.findMany({ where: { companyId: req.params.companyId, active: true }, orderBy: { code: 'asc' } });
    res.json(accounts);
  } catch (error) { next(error); }
});
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).json({ error: 'Internal server error' });
});
