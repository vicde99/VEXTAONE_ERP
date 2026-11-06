import { Router } from 'express';
import argon2 from 'argon2';
import { z } from 'zod';
import { prisma } from './db.js';
import { recordAudit, requireAuth, requireCompanyAccess, requirePermission } from './security.js';

export const adminRouter = Router();

const createUserSchema = z.object({
  email: z.string().email().max(254),
  displayName: z.string().min(2).max(120),
  password: z.string().min(14).max(200),
  roleCodes: z.array(z.string().min(2).max(60)).default([]),
});

const createAccountSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(120),
  accountType: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'OTHER']),
  normalBalance: z.enum(['DEBIT', 'CREDIT']),
  parentCode: z.string().min(1).max(30).optional(),
  statementMapping: z.string().max(60).optional(),
  description: z.string().max(500).optional(),
  controlAccount: z.boolean().default(false),
});

const createFiscalYearSchema = z.object({
  name: z.string().min(2).max(60),
  startsOn: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid start date'),
  endsOn: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid end date'),
});

adminRouter.get('/roles', requireAuth, requirePermission('role.manage'), async (_req, res, next) => {
  try {
    const roles = await prisma.role.findMany({
      orderBy: { name: 'asc' },
      include: { permissions: { include: { permission: true } } },
    });

    res.json(
      roles.map((role) => ({
        id: role.id,
        code: role.code,
        name: role.name,
        permissions: role.permissions.map((grant) => grant.permission.code),
      })),
    );
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/permissions', requireAuth, requirePermission('role.manage'), async (_req, res, next) => {
  try {
    const permissions = await prisma.permission.findMany({ orderBy: { code: 'asc' } });
    res.json(permissions);
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/companies/:companyId/users', requireAuth, requireCompanyAccess, requirePermission('user.read'), async (req, res, next) => {
  try {
    const memberships = await prisma.userCompany.findMany({
      where: { companyId: req.params.companyId },
      include: { user: true, roles: { include: { role: true } } },
      orderBy: { user: { email: 'asc' } },
    });

    res.json(
      memberships.map((membership) => ({
        id: membership.user.id,
        email: membership.user.email,
        displayName: membership.user.displayName,
        active: membership.user.active,
        roles: membership.roles.map((assignment) => assignment.role.code),
      })),
    );
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/companies/:companyId/users', requireAuth, requireCompanyAccess, requirePermission('user.manage'), async (req, res, next) => {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid user payload', issues: parsed.error.issues });
    }

    const companyId = req.params.companyId;
    const { email, displayName, password, roleCodes } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    const validRoles = roleCodes.length ? await prisma.role.findMany({ where: { code: { in: roleCodes } } }) : [];

    if (roleCodes.length && validRoles.length !== roleCodes.length) {
      return res.status(400).json({ error: 'One or more role codes are invalid' });
    }

    const user = await prisma.user.upsert({
      where: { email: normalizedEmail },
      update: { displayName, active: true },
      create: {
        email: normalizedEmail,
        displayName,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      },
    });

    const membership = await prisma.userCompany.upsert({
      where: { userId_companyId: { userId: user.id, companyId } },
      update: {},
      create: { userId: user.id, companyId },
    });

    if (validRoles.length > 0) {
      await prisma.userCompanyRole.createMany({
        data: validRoles.map((role) => ({ userId: user.id, companyId: membership.companyId, roleId: role.id })),
        skipDuplicates: true,
      });
    }

    await recordAudit({
      action: 'user.created',
      companyId,
      userId: req.auth!.userId,
      ipAddress: req.ip,
      metadata: { targetUserId: user.id, roleCodes: validRoles.map((role) => role.code) },
    });

    return res.status(201).json({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: validRoles.map((role) => role.code),
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/companies/:companyId/accounts', requireAuth, requireCompanyAccess, requirePermission('account.read'), async (req, res, next) => {
  try {
    const accounts = await prisma.account.findMany({
      where: { companyId: req.params.companyId, active: true },
      orderBy: { code: 'asc' },
      include: { parent: true },
    });

    res.json(
      accounts.map((account) => ({
        id: account.id,
        code: account.code,
        name: account.name,
        parentCode: account.parent?.code ?? null,
        accountType: account.accountType,
        normalBalance: account.normalBalance,
        active: account.active,
        controlAccount: account.controlAccount,
      })),
    );
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/companies/:companyId/accounts', requireAuth, requireCompanyAccess, requirePermission('account.manage'), async (req, res, next) => {
  try {
    const parsed = createAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid account payload', issues: parsed.error.issues });
    }

    const companyId = req.params.companyId;
    const accountCode = parsed.data.code;
    const existing = await prisma.account.findUnique({
      where: { companyId_code: { companyId, code: accountCode } },
    });

    if (existing) {
      return res.status(409).json({ error: 'An account with this code already exists' });
    }

    const parent = parsed.data.parentCode
      ? await prisma.account.findFirst({
          where: { companyId, code: parsed.data.parentCode, active: true },
        })
      : null;

    if (parsed.data.parentCode && !parent) {
      return res.status(404).json({ error: 'Parent account not found' });
    }

    const account = await prisma.account.create({
      data: {
        companyId,
        parentId: parent?.id,
        code: accountCode,
        name: parsed.data.name,
        accountType: parsed.data.accountType,
        normalBalance: parsed.data.normalBalance,
        statementMapping: parsed.data.statementMapping,
        description: parsed.data.description,
        controlAccount: parsed.data.controlAccount,
      },
    });

    await recordAudit({
      action: 'account.created',
      companyId,
      userId: req.auth!.userId,
      ipAddress: req.ip,
      metadata: { accountId: account.id, code: account.code, name: account.name },
    });

    return res.status(201).json(account);
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/companies/:companyId/fiscal-years', requireAuth, requireCompanyAccess, requirePermission('period.read'), async (req, res, next) => {
  try {
    const fiscalYears = await prisma.fiscalYear.findMany({
      where: { companyId: req.params.companyId },
      orderBy: { startsOn: 'desc' },
      include: { periods: true },
    });

    res.json(fiscalYears);
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/companies/:companyId/fiscal-years', requireAuth, requireCompanyAccess, requirePermission('period.manage'), async (req, res, next) => {
  try {
    const parsed = createFiscalYearSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid fiscal-year payload', issues: parsed.error.issues });
    }

    const startsOn = new Date(parsed.data.startsOn);
    const endsOn = new Date(parsed.data.endsOn);
    if (startsOn > endsOn) {
      return res.status(400).json({ error: 'Fiscal year start date must be before or equal to the end date' });
    }

    const fiscalYear = await prisma.fiscalYear.create({
      data: {
        companyId: req.params.companyId,
        name: parsed.data.name,
        startsOn,
        endsOn,
      },
    });

    await recordAudit({
      action: 'fiscal_year.created',
      companyId: req.params.companyId,
      userId: req.auth!.userId,
      ipAddress: req.ip,
      metadata: { fiscalYearId: fiscalYear.id, name: fiscalYear.name },
    });

    return res.status(201).json(fiscalYear);
  } catch (error) {
    next(error);
  }
});
