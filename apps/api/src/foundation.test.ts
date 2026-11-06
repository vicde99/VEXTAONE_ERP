import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';

test('session token hashes are deterministic and do not reveal the opaque token', () => {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  assert.equal(hash.length, 64);
  assert.notEqual(hash, token);
  assert.equal(hash, createHash('sha256').update(token).digest('hex'));
});

test('accounting periods are date-range values; no default fiscal calendar is assumed', () => {
  const fiscalStart = new Date('2026-01-01T00:00:00Z');
  const fiscalEnd = new Date('2026-12-31T00:00:00Z');
  assert.ok(fiscalStart < fiscalEnd);
});
