import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSkyFixtureSchedule, skyLocalKickoff } from '../scripts/broadcast/sky-fixtures.mjs';
import { skySportsAdapter } from '../scripts/broadcast/adapters/sky-sports.mjs';
import { resolveOfficialFootball } from '../scripts/official-football.mjs';

const source = (date, clock, channels = 'Sky Sports Main Event (19:00), Sky Sports Golf (19:00)') => `<h3>${date}</h3><div class="event-group -layout1"><ul><li><strong>Home FC</strong></li><li class="col col2 span1/5">${clock}</li><li><strong>Away FC</strong></li><a href="https://www.skysports.com/football/home-fc-vs-away-fc/559513">Match Preview</a></ul><p class="event-detail caption">Premier League, ${channels}</p></div>`;
const reference = new Date('2026-10-19T12:00:00Z');

test('Sky local clocks respect BST, winter time and the DST transition', () => {
  assert.equal(skyLocalKickoff(2026, 9, 19, 20, 0), Date.parse('2026-10-19T19:00:00Z') / 1000);
  assert.equal(skyLocalKickoff(2026, 9, 25, 14, 0), Date.parse('2026-10-25T14:00:00Z') / 1000);
  assert.equal(skyLocalKickoff(2026, 9, 25, 1, 30), null);
  assert.equal(skyLocalKickoff(2026, 2, 29, 1, 30), null);
  assert.equal(skyLocalKickoff(2026, 1, 30, 20, 0), null);
  assert.equal(skyLocalKickoff(2026, 9, 19, 24, 0), null);
});

test('Sky preserves displayed channel names and saved v1 IDs while correcting UTC', () => {
  const [candidate] = parseSkyFixtureSchedule(source('Mon 19th October', '20:00', 'Sky Sports Main Event HD (18:30), Sky Sports+ (18:30)'), {}, reference);
  assert.equal(candidate.startUtcEpochSeconds, Date.parse('2026-10-19T19:00:00Z') / 1000);
  assert.equal(candidate.sourceId, `sky-Home FC-Away FC-${Date.parse('2026-10-19T20:00:00Z')}`);
  assert.deepEqual(candidate.sourceIds, { sky: '559513' });
  assert.deepEqual(candidate.broadcasts.map(b => b.channelName), ['Sky Sports Main Event HD', 'Sky Sports+']);
  assert(candidate.broadcasts.every(b => b.territory === 'GB' && b.destinationPrecision === 'channel' && !b.languages));
  const [event] = resolveOfficialFootball([candidate], [], new Map(), reference.getTime() / 1000);
  assert.deepEqual(event.sourceIds, { sky: '559513' });
});

test('Sky rejects wrong weekdays and missing dates without promoting coverage start to kickoff', () => {
  assert.equal(parseSkyFixtureSchedule(source('Tue 19th October', '20:00'), {}, reference).length, 0);
  assert.equal(parseSkyFixtureSchedule(source('Mon 19th October', ''), {}, reference).length, 0);
  assert.equal(parseSkyFixtureSchedule(source('Mon 19th October', '20:00', 'Premier League'), {}, reference).length, 0);
});

test('registered Sky adapter consumes the live event-group structure, including weekend allocations', async () => {
  const candidates = await skySportsAdapter.collect({ fetchText: async () => source('Sun 25th October', '14:00'), verifiedAt: reference.toISOString() });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].startUtcEpochSeconds, Date.parse('2026-10-25T14:00:00Z') / 1000);
  assert.deepEqual(candidates[0].broadcasts.map(b => b.channelName), ['Sky Sports Main Event', 'Sky Sports Golf']);
  assert.equal(candidates[0].broadcasts[0].checkedAt, reference.toISOString());
});
