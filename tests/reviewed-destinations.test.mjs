import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../config/official-event-broadcasters.json' with { type: 'json' };
import { attachAllEventDestinations, attachRightsMetadata, activeAllEventDestinations } from '../scripts/broadcast/rights-catalog.mjs';
const event = (competition = 'LaLiga', season = '2026/27') => ({ competition, season, startUtcEpochSeconds: Date.parse('2026-10-19T18:00:00Z') / 1000, broadcasts: [] });
test('reviewed services preserve country and audio scope without inventing linear channels', () => {
  const e = event(); attachAllEventDestinations([e], config);
  assert.equal(new Set(e.broadcasts.map(b => b.territory)).size, 14);
  assert(e.broadcasts.every(b => b.destinationPrecision === 'service'));
  assert.deepEqual(e.broadcasts.find(b => b.territory === 'US').languages, ['en', 'es']);
  assert.deepEqual(e.broadcasts.find(b => b.territory === 'FR' && b.channelName === 'Disney+').languages, ['fr']);
  assert.equal(e.broadcasts.some(b => b.territory === 'ES'), false);
  assert.equal(e.broadcasts.find(b => b.territory === 'NZ').languages, undefined);
  assert.equal(e.broadcasts.find(b => b.channelName.includes('Prime Video')).languages, undefined);
});
test('source-owned F1 rights survive catalog enrichment; expired catalog rights do not', () => {
  const f1 = { ...event('Formula 1'), broadcastRights: [{ territory: 'GB', holders: [{ name: 'Sky Sports' }] }] };
  const old = { ...event('LaLiga', '2024/25'), broadcastRights: [{ territory: 'US' }] };
  attachRightsMetadata([f1, old], config);
  assert.equal(f1.broadcastRights[0].territory, 'GB'); assert.equal(old.broadcastRights, undefined);
});
test('sidecar preserves explicit audio and viewing evidence for both consumers', () => {
  const rules = activeAllEventDestinations(config, Date.parse('2026-10-18T12:00:00Z') / 1000);
  const rule = rules.find(r => r.competitionId === 'serie-a' && r.territory === 'AU' && r.name === 'beIN SPORTS CONNECT');
  assert.deepEqual(rule.languages, ['en', 'it']);
  assert.equal(rule.languageEvidence.sourceUrl, rule.sourceUrl);
  assert.equal(rule.viewingUrl, 'https://connect-au.beinsports.com/');
});
