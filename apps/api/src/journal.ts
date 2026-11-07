import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from './db.js';
import { requireAuth, requireCompanyAccess, requirePermission } from './security.js';

export const accountingRouter = Router();

const amountSchema = z.coerce.string().regex(/^\d{1,15}(?:\.\d{1,2})?$/, 'Amount must be a non-negative decimal with at most two places');
const lineSchema = z.object({
  accountCode: z.string().trim().min(1).max(30),
  description: z.string().trim().max(250).optional(),
  debit: amountSchema,
  credit: amountSchema,
});
const createJournalSchema = z.object({
  journalNo: z.string().trim().min(2).max(40),
  journalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  periodId: z.string().uuid(),
  entryType: z.enum(['GENERAL', 'ADJUSTING', 'CLOSING', 'REVERSING', 'CUSTOM']),
  description: z.string().trim().min(3).max(500),
  sourceModule: z.string().trim().max(60).optional(),
  sourceDocumentId: z.string().trim().max(100).optional(),
  reversalOfId: z.string().uuid().optional(),
  lines: z.array(lineSchema).min(2).max(100),
});

function parseDateOnly(value: string): Date | null {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

export function validateJournalEntry(input: unknown) {
  const parsed = createJournalSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, issues: parsed.error.issues };

  const lines = parsed.data.lines.map((line) => ({
    ...line,
    debitDecimal: new Prisma.Decimal(line.debit),
    creditDecimal: new Prisma.Decimal(line.credit),
  }));
  const debitTotal = lines.reduce((total, line) => total.add(line.debitDecimal), new Prisma.Decimal(0));
  const creditTotal = lines.reduce((total, line) => total.add(line.creditDecimal), new Prisma.Decimal(0));

  if (lines.some((line) => line.debitDecimal.isZero() === line.creditDecimal.isZero())) {
    return { ok: false as const, issues: [{ path: ['lines'], message: 'Each line must have a positive debit or credit, but not both' }] };
  }
  if (debitTotal.isZero() || !debitTotal.equals(creditTotal)) {
    return { ok: false as const, issues: [{ path: ['lines'], message: 'Debit and credit totals must be equal and greater than zero' }] };
  }

  const journalDate = parseDateOnly(parsed.data.journalDate);
  if (!journalDate) return { ok: false as const, issues: [{ path: ['journalDate'], message: 'Invalid calendar date' }] };
  return { ok: true as const, data: parsed.data, lines, journalDate };
}

accountingRouter.post('/companies/:companyId/journal-entries', requireAuth, requireCompanyAccess, requirePermission('journal.post'), async (req, res, next) => {
  try {
    const validation = validateJournalEntry(req.body);
    if (!validation.ok) return res.status(400).json({ error: 'Invalid journal entry payload', issues: validation.issues });

    const companyId = req.params.companyId;
    const accountCodes = [...new Set(validation.lines.map((line) => line.accountCode))];
    const accounts = await prisma.account.findMany({
      where: { companyId, code: { in: accountCodes }, active: true, postingRestricted: false },
    });
    const accountMap = new Map(accounts.map((account) => [account.code, account]));
    const missingAccount = accountCodes.find((code) => !accountMap.has(code));
    if (missingAccount) return res.status(400).json({ error: `Account ${missingAccount} is inactive, restricted, or not part of this company` });

    const period = await prisma.accountingPeriod.findFirst({
      where: {
        id: validation.data.periodId,
        status: 'OPEN',
        startsOn: { lte: validation.journalDate },
        endsOn: { gte: validation.journalDate },
        fiscalYear: { companyId, status: 'OPEN' },
      },
      select: { id: true },
    });
    if (!period) return res.status(400).json({ error: 'The date must fall within an open accounting period for this company' });

    const sourceModule = validation.data.sourceModule ?? 'MANUAL';
    const sourceDocumentId = validation.data.sourceDocumentId;
    const entry = await prisma.$transaction(async (tx) => {
      const draft = await tx.journalEntry.create({
        data: {
          companyId,
          periodId: period.id,
          journalNo: validation.data.journalNo,
          journalDate: validation.journalDate,
          entryType: validation.data.entryType,
          description: validation.data.description,
          sourceModule,
          sourceDocumentId,
          reversalOfId: validation.data.reversalOfId,
          createdByUserId: req.auth!.userId,
          status: 'DRAFT',
          lines: {
            create: validation.lines.map((line) => ({
              accountId: accountMap.get(line.accountCode)!.id,
              description: line.description ?? validation.data.description,
              debitAmount: line.debitDecimal,
              creditAmount: line.creditDecimal,
            })),
          },
        },
      });

      const posted = await tx.journalEntry.update({
        where: { id: draft.id },
        data: { status: 'POSTED', postedByUserId: req.auth!.userId, postedAt: new Date() },
        include: { lines: { include: { account: true } }, period: true },
      });

      await tx.auditEvent.create({
        data: {
          action: 'journal_entry.posted',
          companyId,
          userId: req.auth!.userId,
          ipAddress: req.ip,
          entityType: 'JournalEntry',
          entityId: posted.id,
          metadata: {
            journalNo: posted.journalNo,
            periodId: period.id,
            sourceModule,
            sourceDocumentId: sourceDocumentId ?? null,
            debitTotal: validation.lines.reduce((total, line) => total.add(line.debitDecimal), new Prisma.Decimal(0)).toFixed(2),
            creditTotal: validation.lines.reduce((total, line) => total.add(line.creditDecimal), new Prisma.Decimal(0)).toFixed(2),
          },
        },
      });
      return posted;
    });

    return res.status(201).json(entry);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: 'Journal number or source document has already been posted' });
    }
    next(error);
  }
});

accountingRouter.get('/companies/:companyId/journal-entries', requireAuth, requireCompanyAccess, requirePermission('journal.read'), async (req, res, next) => {
  try {
    const parsed = z.object({
      take: z.coerce.number().int().min(1).max(100).default(50),
      skip: z.coerce.number().int().min(0).default(0),
      status: z.enum(['DRAFT', 'POSTED']).optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query parameters' });

    const from = parsed.data.from ? parseDateOnly(parsed.data.from) : undefined;
    const to = parsed.data.to ? parseDateOnly(parsed.data.to) : undefined;
    if ((parsed.data.from && !from) || (parsed.data.to && !to) || (from && to && from > to)) {
      return res.status(400).json({ error: 'Invalid date range' });
    }

    const rows = await prisma.journalEntry.findMany({
      where: {
        companyId: req.params.companyId,
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(from || to ? { journalDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
      orderBy: [{ journalDate: 'desc' }, { journalNo: 'desc' }],
      skip: parsed.data.skip,
      take: parsed.data.take,
      include: { period: true, lines: { include: { account: true } } },
    });
    return res.json(rows);
  } catch (error) {
    next(error);
  }
});
