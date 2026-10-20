// Independent, read-only-source refresh for review. No remote publication and
// no dependency on TheSportsDB quotas. Existing records never gain extra age.
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseLaLiga, resolveOfficialFootball } from './official-football.mjs';
import { mergeCollectedEvents, selectEvents, validateFeed } from './feed-core.mjs';
import { beinMenaAdapter } from './broadcast/adapters/bein-mena.mjs';
import { skySportsAdapter } from './broadcast/adapters/sky-sports.mjs';
import { discoverOfficialDestinations, buildDiscoveryCoverage } from './broadcast/discovery.mjs';
import { resolveExactBroadcasts, broadcastTerritories } from './broadcast/resolver.mjs';
import { attachRightsMetadata, attachAllEventDestinations, activeAllEventDestinations } from './broadcast/rights-catalog.mjs';
import { collectEuropeanFixtures } from './european-fixtures.mjs';
import { previewBaseline } from './preview-baseline.mjs';
import { isUnconfirmedLegacyChannel } from './broadcast/channel-status.mjs';

const output = process.argv[2];
if (!output) throw new Error('Provide a dedicated local preview output directory');
const folder = resolve(output);
const repository = resolve(import.meta.dirname, '..');
if (folder === resolve(repository, 'feed/events/v1')) throw new Error('Use a preview directory; this command does not replace the published feed');
const now = Math.floor(Date.now() / 1000), checkedAt = new Date(now * 1000).toISOString();
const config = JSON.parse(await readFile(new URL('../config/official-event-broadcasters.json', import.meta.url), 'utf8'));
const captures = [];
async function fetchText(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json,text/html', 'User-Agent': 'WhoseIPTV-Events/1.0' } });
  if (!r.ok) { const error = new Error(`HTTP ${r.status}`); error.status = r.status; throw error; }
  const body = await r.text();
  if (body.length > 4_000_000) throw new Error('Source response exceeds size bound');
  if (url.includes('/api/opta/')) { captures.push({ url, body: JSON.parse(body) }); await new Promise(r => setTimeout(r, 250)); }
  return body;
}
const [baselineResult, laligaResult, skyResult] = await Promise.allSettled([
  fetchText('https://raw.githubusercontent.com/craetsodom-hub/whoseiptv/main/feed/events/v1/events.json').then(JSON.parse),
  fetchText('https://www.laliga.com/laliga-easports/resultados').then(body => resolveOfficialFootball(parseLaLiga(body), [], new Map(), now)),
  discoverOfficialDestinations([skySportsAdapter], { fetchText, verifiedAt: checkedAt }),
]);
const baseline = previewBaseline(baselineResult.status === 'fulfilled' ? baselineResult.value : null, now);
const fresh = laligaResult.status === 'fulfilled' ? laligaResult.value : [];
const sky = skyResult.status === 'fulfilled' ? skyResult.value : { candidates: [], attempts: [{ id: skySportsAdapter.id, success: false, candidates: 0, failure: 'Sky schedule unavailable' }] };
fresh.push(...resolveOfficialFootball(sky.candidates, [], new Map(), now));
if (laligaResult.status !== 'fulfilled') console.error(JSON.stringify({ source: 'laliga', outcome: 'unavailable' }));
for (const event of fresh) for (const broadcast of event.broadcasts) broadcast.checkedAt = broadcast.verifiedAt = checkedAt;
// Replace same-ID fixtures with current organizer data, so a reschedule cannot
// inherit an old exact-channel assignment through a duplicate ID.
const freshIds = new Set(fresh.map(e => e.id));
const european = await collectEuropeanFixtures({fetchText, nowEpochSeconds:now, onFailure:failure=>console.error(JSON.stringify(failure))});
const events = mergeCollectedEvents([...baseline.events.filter(e => !freshIds.has(e.id)), ...fresh, ...european]).filter(e => e.startUtcEpochSeconds >= now && e.startUtcEpochSeconds < now + 7 * 86400);
for (const event of events) event.broadcasts = event.broadcasts.filter(b => b.sourceType !== 'source-event' || !isUnconfirmedLegacyChannel(b.channelName, b.territory, event.startUtcEpochSeconds));
attachRightsMetadata(events, config);
attachAllEventDestinations(events, config);
const count = () => events.reduce((n, event) => n + new Set(event.broadcasts.filter(b => b.confirmed && b.destinationPrecision !== 'service' && ['official-event', 'official-broadcaster-schedule'].includes(b.sourceType)).flatMap(broadcastTerritories)).size, 0);
const before = count();
const bein = await discoverOfficialDestinations([beinMenaAdapter], { fetchText, verifiedAt: checkedAt });
const discovery = { candidates: [...sky.candidates, ...bein.candidates], attempts: [...sky.attempts, ...bein.attempts] };
for (const candidate of discovery.candidates) for (const broadcast of candidate.broadcasts) broadcast.checkedAt = checkedAt;
resolveExactBroadcasts(events, discovery.candidates);
if (!events.length) throw new Error('No fresh fixtures; preserving the previous preview and its strict expiry');
const feed = { schemaVersion: 1, generatedAtEpochSeconds: now, validUntilEpochSeconds: Math.min(baseline.expires ?? Infinity, now + 6 * 3600), events: selectEvents(events) };
validateFeed(feed, now);
const coverage = buildDiscoveryCoverage(events, [skySportsAdapter, beinMenaAdapter], discovery.attempts);
coverage.allEventDestinations = activeAllEventDestinations(config, now);
coverage.baseline = { state: baseline.state, validUntilEpochSeconds: baseline.expires };
const report = { checkedAt, beforeExactPairs: before, afterExactPairs: count(), events: events.length, attempts: discovery.attempts,
  examples: events.filter(e => e.broadcasts.some(b => b.matchingMethod === 'bein-epg-title-competition-programme-window')).map(e => ({ id: e.id, title: e.title, startsAt: new Date(e.startUtcEpochSeconds * 1000).toISOString(), broadcasts: e.broadcasts.filter(b => b.matchingMethod === 'bein-epg-title-competition-programme-window') })) };
await mkdir(folder, { recursive: true });
for (const [name, value] of [['events.json', feed], ['coverage.json', coverage], ['audit.json', report], ['source-capture.json', { checkedAt, captures }]]) {
  const file = resolve(folder, name); await writeFile(file + '.tmp', JSON.stringify(value, null, 2)); await rename(file + '.tmp', file);
}
console.log(JSON.stringify({ ...report, examples: report.examples.map(e => ({ id: e.id, title: e.title, channels: e.broadcasts.map(b => b.channelName), territories: [...new Set(e.broadcasts.flatMap(broadcastTerritories))] })) }, null, 2));
