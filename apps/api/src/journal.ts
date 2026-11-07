import { Router } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma } from './db.js';
import { requireAuth, requireCompanyAccess, requirePermission } from './security.js';

export const accountingRouter = Router();

const journalLineSchema = z.object({
  accountCode: z.string().trim().min(1).max(30),
  description: z.string().trim().max(250).optional(),
  debit: z.coerce.number().nonnegative().finite().multipleOf(0.01).max(1_000_000_000_000),
  credit: z.coerce.number().nonnegative().finite().multipleOf(0.01).max(1_000_000_000_000),
});

const journalEntrySchema = z.object({
  journalNo: z.string().trim().min(2).max(40),
  entryType: z.enum(['GENERAL', 'ADJUSTING', 'CLOSING', 'REVERSING', 'CUSTOM']),
  description: z.string().trim().min(3).max(500),
  lines: z.array(journalLineSchema).min(2).max(50),
});

export function normalizeJournalEntryPayload(input: unknown) {
  const parsed = journalEntrySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, issues: parsed.error.issues };
  }

  const totals = parsed.data.lines.reduce(
    (acc, line) => ({
      debit: acc.debit + Number(line.debit),
      credit: acc.credit + Number(line.credit),
    }),
    { debit: 0, credit: 0 },
  );

  if (Math.abs(totals.debit - totals.credit) > 0.005) {
    return { ok: false as const, issues: [{ path: ['lines'], message: 'Debit and credit totals must be equal for a balanced journal entry' }] };
  }

  return { ok: true as const, data: parsed.data };
}

accountingRouter.post('/companies/:companyId/journal-entries', requireAuth, requireCompanyAccess, requirePermission('account.manage'), async (req, res, next) => {
  try {
    const validation = normalizeJournalEntryPayload(req.body);
    if (!validation.ok) {
      return res.status(400).json({ error: 'Invalid journal entry payload', issues: validation.issues });
    }

    const companyId = req.params.companyId;
    const uniqueCodes = new Set(validation.data.lines.map((line) => line.accountCode));
    if (uniqueCodes.size !== validation.data.lines.length) {
      return res.status(400).json({ error: 'Each journal line must reference a distinct account' });
    }

    const accounts = await prisma.account.findMany({
      where: { companyId, code: { in: validation.data.lines.map((line) => line.accountCode) }, active: true },
    });
    const accountMap = new Map(accounts.map((account) => [account.code, account]));
    const missingAccount = validation.data.lines.find((line) => !accountMap.has(line.accountCode));
    if (missingAccount) {
      return res.status(404).json({ error: `Account ${missingAccount.accountCode} not found` });
    }

    const posted = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const entry = await tx.journalEntry.create({
        data: {
          companyId,
          journalNo: validation.data.journalNo,
          entryType: validation.data.entryType,
          description: validation.data.description,
          status: 'POSTED',
          sourceModule: 'ERP',
          createdByUserId: req.auth!.userId,
          lines: {
            create: validation.data.lines.map((line) => ({
              accountId: accountMap.get(line.accountCode)!.id,
              description: line.description ?? validation.data.description,
              debitAmount: new Prisma.Decimal(Number(line.debit).toFixed(2)),
              creditAmount: new Prisma.Decimal(Number(line.credit).toFixed(2)),
            })),
          },
        },
        include: { lines: { include: { account: true } } },
      });

      await tx.auditEvent.create({
        data: {
          action: 'journal_entry.posted',
          companyId,
          userId: req.auth!.userId,
          ipAddress: req.ip,
          metadata: { journalEntryId: entry.id, journalNo: entry.journalNo, totalDebit: validation.data.lines.reduce((total, line) => total + Number(line.debit), 0), totalCredit: validation.data.lines.reduce((total, line) => total + Number(line.credit), 0) },
        },
      });

      return entry;
    });

    return res.status(201).json(posted);
  } catch (error) {
    next(error);
  }
});
