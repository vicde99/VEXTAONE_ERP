import test from 'node:test';
import assert from 'node:assert/strict';
import { isTrustedOrigin } from './origin.js';

test('accepts an exact origin even when the configured URL has a path', () => {
  assert.equal(isTrustedOrigin('https://erp.example.com', 'https://erp.example.com/app'), true);
});

test('rejects origin-prefix attacks and different ports', () => {
  assert.equal(isTrustedOrigin('https://erp.example.com.attacker.test', 'https://erp.example.com'), false);
  assert.equal(isTrustedOrigin('https://erp.example.com:444', 'https://erp.example.com'), false);
});

test('rejects malformed, missing, and non-web origins', () => {
  assert.equal(isTrustedOrigin(undefined, 'https://erp.example.com'), false);
  assert.equal(isTrustedOrigin('not an origin', 'https://erp.example.com'), false);
  assert.equal(isTrustedOrigin('file:///etc/passwd', 'file:///etc/passwd'), false);
});
