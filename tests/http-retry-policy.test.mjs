import test from 'node:test';
import assert from 'node:assert/strict';
import { retryAfterMilliseconds, retryDelayMilliseconds } from '../scripts/http-retry-policy.mjs';
test('provider Retry-After seconds and HTTP dates are never shortened to 30 seconds', () => {
  const now = Date.parse('2026-10-18T10:00:00Z');
  assert.equal(retryAfterMilliseconds('120', now), 120000);
  assert.equal(retryAfterMilliseconds('Sun, 18 Oct 2026 10:02:00 GMT', now), 120000);
  assert.equal(retryDelayMilliseconds({ status: 429, retryAfterMs: 120000 }, 0), 120000);
  assert.equal(retryAfterMilliseconds('bad-date', now), null);
  assert.equal(retryAfterMilliseconds(null, now), null);
  assert.equal(retryDelayMilliseconds({ status: 429 }, 1), 30000);
  assert.equal(retryDelayMilliseconds({ status: 503 }, 0), 2000);
});
