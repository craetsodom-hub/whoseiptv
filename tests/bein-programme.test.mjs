import test from 'node:test';
import assert from 'node:assert/strict';
import { beinMenaAdapter, parseBeinMenaApi } from '../scripts/broadcast/adapters/bein-mena.mjs';
import { resolveExactBroadcasts } from '../scripts/broadcast/resolver.mjs';
import { discoverOfficialDestinations } from '../scripts/broadcast/discovery.mjs';

// Reduced first-party response observed 2026-10-18. The programme starts an
// hour before kickoff; its empty match fields must not become a fake kickoff.
const row = () => ({ live: true, replay: false, startDate: '2026-10-18T18:00:00.000Z',
  channel: { name: 'beIN SPORTS 1', externalId: '10401', provider: { name: 'epg.bein' } },
  data: { m_date: null, m_time: '', teama: '', teamb: '', competition_name: '', Live: 'True',
    ChannelName: 'beIN SPORTS 1', ChannelCode: '10401', Duration: '03:30:00',
    Title: { English: 'Real Madrid vs Sevilla - Spanish LaLiga 2026/2027 - Week 9' },
    Category: { English: 'Spanish League - Primera División' } } });
const event = () => ({ id: 'laliga-102336', sport: 'football', competition: 'LaLiga',
  homeTeam: { name: 'Real Madrid' }, awayTeam: { name: 'Sevilla FC' },
  startUtcEpochSeconds: Date.parse('2026-10-18T19:00:00Z') / 1000, broadcasts: [],
  broadcastRights: [{ territory: 'MA', holders: [{ name: 'beIN Sports' }] }] });
async function candidates(rows = [row()]) {
  return beinMenaAdapter.collect({ verifiedAt: '2026-10-18T16:37:00Z', fetchText: async url => url.includes('/api/') ? JSON.stringify({ rows }) : '' });
}
test('MENA programme titles resolve to independent fixture kickoff and country rights', async () => {
  const [candidate] = await candidates();
  assert.equal(candidate.startUtcEpochSeconds, undefined);
  const target = event();
  resolveExactBroadcasts([target], [candidate]);
  assert.equal(target.startUtcEpochSeconds, Date.parse('2026-10-18T19:00:00Z') / 1000);
  assert.equal(target.broadcasts[0].channelName, 'beIN SPORTS 1');
  assert.deepEqual(target.broadcasts[0].territories, ['MA']);
  assert.equal(target.broadcasts[0].confirmed, true);
  assert.equal(target.broadcasts[0].languages, undefined);
  assert.match(target.broadcasts[0].eventMatchingMethod, /^programme-window:/);
});
test('programme identity rejects wrong teams, competition, rescheduling and ambiguity', async () => {
  const source = await candidates();
  for (const modify of [e => e.awayTeam.name = 'Real Betis', e => e.competition = 'UEFA Champions League',
    e => e.startUtcEpochSeconds += 86400, e => e.startUtcEpochSeconds -= 3700,
    e => e.startUtcEpochSeconds += 7200, e => e.broadcastRights = []]) {
    const target = event(); modify(target); resolveExactBroadcasts([target], source);
    assert.equal(target.broadcasts.length, 0);
  }
  const ambiguous = [event(), { ...event(), id: 'another' }];
  resolveExactBroadcasts(ambiguous, source);
  assert.ok(ambiguous.every(e => e.broadcasts.length === 0));
});
test('MENA parser rejects regional collisions, weak titles, missing UTC and partial identity', () => {
  for (const modify of [r => r.channel.provider.name = 'epg.apac.aus', r => r.channel.externalId = 'other',
    r => r.live = false, r => r.replay = true, r => r.data.Live = 'False',
    r => r.data.teama = 'Different team', r => r.data.Category.English = 'UEFA Youth League',
    r => r.data.Title.English += ' Highlights', r => r.data.Duration = '24:00:00',
    r => r.data.Duration = '00:30:00', r => r.startDate = '2026-10-18T18:00:00',
    r => r.data.Title.English = r.data.Title.English.replace('2026/2027', '2025/2026')]) {
    const value = row(); modify(value); assert.equal(parseBeinMenaApi({ rows: [value] }).length, 0);
  }
});
test('a missing middle EPG page does not suppress subsequent independent pages', async () => {
  const urls = [];
  const values = await beinMenaAdapter.collect({ verifiedAt: '2026-10-18', fetchText: async url => {
    urls.push(url);
    if (url.includes('offset=100')) throw new Error('HTTP 503');
    return url.includes('offset=200') ? JSON.stringify({ rows: [row()] }) : JSON.stringify({ count: 300, rows: [] });
  } });
  assert.equal(values.length, 1);
  assert.ok(urls.some(url => url.includes('offset=200')));
});
test('rate limits stop EPG pagination', async () => {
  const urls = [];
  await beinMenaAdapter.collect({ verifiedAt: '2026-10-18', fetchText: async url => {
    urls.push(url); if (url.includes('offset=100')) throw new Error('HTTP 429');
    return JSON.stringify({ count: 400, rows: [] });
  } });
  assert.ok(!urls.some(url => url.includes('offset=200')));
});

test('partial-page health remains visible while usable candidates survive', async () => {
  const result = await discoverOfficialDestinations([beinMenaAdapter], { verifiedAt: '2026-10-18', fetchText: async url => {
    if (url.includes('offset=100')) throw new Error('HTTP 503');
    return url.includes('/api/') ? JSON.stringify({ count: 200, rows: [row()] }) : '';
  } });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.attempts[0].success, false);
  assert.equal(result.attempts[0].partial, true);
});
test('English feed audio requires the reviewed primary FAQ and never leaks to numbered feeds', async () => {
  const english = row(); english.channel.name = english.data.ChannelName = 'beIN SPORTS EN 1';
  const source = await beinMenaAdapter.collect({ verifiedAt: '2026-10-18T16:45:00Z', fetchText: async url => url.includes('/api/') ? JSON.stringify({ rows: [english, row()] }) : '' });
  const target = event(); resolveExactBroadcasts([target], source);
  const en = target.broadcasts.find(b => b.channelName === 'beIN SPORTS EN 1');
  assert.deepEqual(en.languages, ['en']);
  assert.equal(en.languageEvidence.scope, 'feed-audio');
  assert.match(en.languageEvidence.sourceUrl, /^https:\/\/www.bein.com\/en\/ufaq\//);
  assert.equal(target.broadcasts.find(b => b.channelName === 'beIN SPORTS 1').languages, undefined);
});
