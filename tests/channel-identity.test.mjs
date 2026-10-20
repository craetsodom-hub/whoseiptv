import test from 'node:test';
import assert from 'node:assert/strict';
import { stableChannelId, verifiedLanguageEvidence } from '../scripts/broadcast/channel-identity.mjs';
import { mergeExactBroadcasts } from '../scripts/broadcast/resolver.mjs';
import { validateFeed } from '../scripts/feed-core.mjs';
test('regional feeds, numbered channels and language variants never merge silently', () => {
  const rows = [
    { channelName: 'beIN SPORTS 1', territory: 'MA' },
    { channelName: 'beIN SPORTS 2', territory: 'MA' },
    { channelName: 'beIN SPORTS EN 1', territory: 'MA' },
    { channelName: 'beIN SPORTS 1', territory: 'FR' },
    { channelName: 'Sky Sport 1 Austria', territory: 'AT' },
    { channelName: 'Sky Sports Premier League', territory: 'GB' },
  ].map(item => ({ ...item, sourceType: 'official-event', sourceUrl: 'https://official.example/event', confirmed: true }));
  assert.equal(new Set(rows.map(stableChannelId)).size, 6);
  const merged = mergeExactBroadcasts(rows);
  assert.equal(merged.length, 6);
  assert(merged.every(b => b.originalChannelName === b.channelName));
});
test('language fields require an explicit audio evidence contract', () => {
  const item = { channelName: 'Example English TV', territory: 'GB', sourceType: 'official-event', sourceUrl: 'https://official.example/event', languages: ['en'] };
  assert.equal(mergeExactBroadcasts(item)[0].languages, undefined);
  const languageEvidence = { scope: 'event-audio', verifiedAt: '2026-10-18T10:00:00Z', sourceUrl: item.sourceUrl };
  assert.deepEqual(mergeExactBroadcasts({ ...item, languageEvidence })[0].languages, ['en']);
  assert.equal(verifiedLanguageEvidence({ ...item, languageEvidence: { ...languageEvidence, sourceUrl: 'https://other.example' } }), undefined);
});

test('official event platforms preserve v1 confirmation while retaining service precision', () => {
  const broadcasts = mergeExactBroadcasts({ channelName: 'Apple TV', territory: 'US', sourceType: 'official-event', sourceUrl: 'https://www.mlssoccer.com/event', matchingMethod: 'official-event-id', confirmed: true, destinationPrecision: 'channel' });
  assert.equal(broadcasts[0].destinationPrecision, 'service');
  const now = 1792317600;
  assert.equal(validateFeed({ schemaVersion: 1, generatedAtEpochSeconds: now, validUntilEpochSeconds: now + 43200, events: [{ id: 'mls-example', title: 'Example vs Example', sport: 'football', status: 'confirmed', startUtcEpochSeconds: now + 3600, broadcasts }] }, now), true);
});
