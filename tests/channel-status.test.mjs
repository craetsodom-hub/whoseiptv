import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFeed } from '../scripts/feed-core.mjs';
import { isUnconfirmedLegacyChannel } from '../scripts/broadcast/channel-status.mjs';
test('legacy labels stay historical and territory-specific without guessed replacements', () => {
  assert(isUnconfirmedLegacyChannel('MultiSports 6 FR', 'FR', 1792778400));
  assert(!isUnconfirmedLegacyChannel('MultiSports 6 FR', 'US', 1792778400));
  assert(!isUnconfirmedLegacyChannel('MultiSports 6 FR', 'FR', 1704067200));
});
test('fresh football fixtures survive removal of an unconfirmed retired-channel listing', () => {
  const now = 1792411200;
  const feed = buildFeed([{ __sport: 'football', __territory: 'FR', idEvent: '12345', strEvent: 'Home vs Away', strChannel: 'MultiSports 6 FR', strTimeStamp: new Date((now + 3600) * 1000).toISOString() }], {}, now);
  assert.equal(feed.events.length, 1);
  assert.deepEqual(feed.events[0].broadcasts, []);
});
