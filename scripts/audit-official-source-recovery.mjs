import { readFile, writeFile } from 'node:fs/promises';
import { OFFICIAL_BROADCAST_ADAPTERS } from './broadcast/adapters/index.mjs';
import { discoverOfficialDestinations } from './broadcast/discovery.mjs';
import { resolveExactBroadcasts, broadcastTerritories } from './broadcast/resolver.mjs';
const now = Math.floor(Date.now() / 1000);
const feed = JSON.parse(await readFile('.preview-bein/events.json', 'utf8'));
if (!(feed.validUntilEpochSeconds > now)) throw Error('Fresh local source snapshot required');
const events = structuredClone(feed.events);
let active = 0; const waiting = [];
async function fetchText(url) {
  if (active >= 3) await new Promise(resolve => waiting.push(resolve));
  active++;
  try {
    const result = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json,text/html' } });
    if (!result.ok) throw Error(`HTTP ${result.status}`);
    const text = await result.text(); if (text.length > 4_000_000) throw Error('oversize'); return text;
  } finally { active--; waiting.shift()?.(); }
}
const adapters = OFFICIAL_BROADCAST_ADAPTERS.filter(a => a.id !== 'bein-mena');
const result = await discoverOfficialDestinations(adapters, { fetchText, verifiedAt: new Date(now * 1000).toISOString() });
const keys = () => new Set(events.flatMap(e => e.broadcasts.filter(b => ['official-event', 'official-broadcaster-schedule'].includes(b.sourceType)).flatMap(b => broadcastTerritories(b).map(t => `${e.id}|${t}|${b.channelName}`))));
const before = keys();
resolveExactBroadcasts(events, result.candidates);
const after = keys();
const report = { checkedAt: new Date().toISOString(), attempts: result.attempts, additionalVerifiedDestinations: [...after].filter(k => !before.has(k)), candidateCount: result.candidates.length };
await writeFile('docs/OFFICIAL-SOURCE-RECOVERY-AUDIT.json', JSON.stringify(report, null, 2));
await writeFile('.tmp-official-source-recovery.json', JSON.stringify({ report, candidates: result.candidates, events }, null, 2));
console.log(JSON.stringify(report, null, 2));
