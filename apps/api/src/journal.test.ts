import test from 'node:test';
import assert from 'node:assert/strict';
import { validateJournalEntry } from './journal.js';

const valid = {
  journalNo: 'JE-2026-001',
  journalDate: '2026-01-15',
  periodId: '00000000-0000-4000-8000-000000000001',
  entryType: 'GENERAL',
  description: 'Opening cash balance',
  lines: [
    { accountCode: '1000', debit: '1000.00', credit: '0' },
    { accountCode: '3000', debit: '0', credit: '1000.00' },
  ],
};

test('accepts a balanced journal using exact decimal arithmetic', () => {
  const result = validateJournalEntry(valid);
  assert.equal(result.ok, true);
});

test('rejects unbalanced entries', () => {
  const result = validateJournalEntry({ ...valid, lines: [
    { accountCode: '1000', debit: '100.00', credit: '0' },
    { accountCode: '3000', debit: '0', credit: '99.99' },
  ] });
  assert.equal(result.ok, false);
});

test('rejects lines with both debit and credit or both zero', () => {
  const bothSides = validateJournalEntry({ ...valid, lines: [
    { accountCode: '1000', debit: '1.00', credit: '1.00' },
    { accountCode: '3000', debit: '0', credit: '0' },
  ] });
  assert.equal(bothSides.ok, false);
});

test('rejects impossible dates and excessive decimal precision', () => {
  assert.equal(validateJournalEntry({ ...valid, journalDate: '2026-02-30' }).ok, false);
  assert.equal(validateJournalEntry({ ...valid, lines: [
    { accountCode: '1000', debit: '1.001', credit: '0' },
    { accountCode: '3000', debit: '0', credit: '1.001' },
  ] }).ok, false);
});
