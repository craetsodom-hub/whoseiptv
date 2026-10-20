import test from 'node:test';
import assert from 'node:assert/strict';
import { previewBaseline } from '../scripts/preview-baseline.mjs';
const now = 1792411200;
const feed = (extra = {}) => ({ schemaVersion: 1, generatedAtEpochSeconds: now - 3600, validUntilEpochSeconds: now + 3600, events: [{ id: 'fixture', title: 'Home vs Away', sport: 'football', status: 'confirmed', startUtcEpochSeconds: now + 7200, broadcasts: [] }], ...extra });
test('fresh baseline keeps its original expiry ceiling', () => {
  const result = previewBaseline(feed(), now);
  assert.equal(result.state, 'ready'); assert.equal(result.events.length, 1); assert.equal(result.expires, now + 3600);
});
test('expired baseline contributes neither fixtures nor channels nor renewed expiry', () => {
  for (const input of [feed({ validUntilEpochSeconds: now }), feed({ generatedAtEpochSeconds: now + 1 }), feed({ generatedAtEpochSeconds: now - 50000, validUntilEpochSeconds: now - 10000 })]) {
    const result = previewBaseline(input, now);
    assert.equal(result.state, 'expired'); assert.deepEqual(result.events, []); assert.equal(result.expires, null);
  }
});
test('missing or invalid baseline does not prevent independent source refresh', () => {
  for (const input of [undefined, {}, feed({ schemaVersion: 2 }), feed({ validUntilEpochSeconds: NaN }), feed({ validUntilEpochSeconds: now + 86400 })]) {
    assert.deepEqual(previewBaseline(input, now), { events: [], state: 'invalid', expires: null });
  }
});
