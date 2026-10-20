import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { attachAllEventDestinations } from '../scripts/broadcast/rights-catalog.mjs';
const config = JSON.parse(readFileSync(new URL('../config/official-event-broadcasters.json', import.meta.url)));
const fixture = (extra = {}) => ({ competition: 'MLS', startUtcEpochSeconds: Date.parse('2026-10-20T19:00:00Z') / 1000, broadcasts: [], ...extra });
test('calendar-year MLS destinations work without a source season, without invented channels or audio', () => {
  const [event] = attachAllEventDestinations([fixture()], config);
  assert(event.broadcasts.some(b => b.territory === 'IN' && b.channelName === 'Apple TV'));
  assert(event.broadcasts.some(b => b.territory === 'GH'));
  assert(event.broadcasts.every(b => b.destinationPrecision === 'service' && !b.languages));
  assert(!event.broadcasts.some(b => ['NG', 'KE', 'MA'].includes(b.territory)));
});
test('explicit wrong seasons and dates outside the reviewed term do not receive destinations', () => {
  for (const event of [fixture({ season: '2025' }), fixture({ startUtcEpochSeconds: Date.parse('2027-10-20T19:00:00Z') / 1000 })]) {
    attachAllEventDestinations([event], config);
    assert.equal(event.broadcasts.length, 0);
  }
});
test('Australian UEFA streaming remains a platform, not an invented linear channel', () => {
  const [event] = attachAllEventDestinations([fixture({ competition: 'UEFA Champions League' })], config);
  assert(event.broadcasts.some(b => b.territory === 'AU' && b.channelName === 'Stan Sport' && b.destinationPrecision === 'service'));
});
