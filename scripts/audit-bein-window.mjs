import { writeFile } from 'node:fs/promises';
import { beinMenaAdapter } from './broadcast/adapters/bein-mena.mjs';
let requests = 0;
const samples = [];
const candidates = await beinMenaAdapter.collect({ verifiedAt: new Date().toISOString(), fetchText: async url => {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) }); requests++;
  if (!r.ok) throw new Error(`beIN HTTP ${r.status}; Retry-After ${r.headers.get('retry-after') ?? 'unspecified'}`);
  const body = await r.text();
  if (url.includes('/api/')) {
    const json = JSON.parse(body);
    const relevant = (json.rows ?? []).filter(row => /madrid|sevilla/i.test(JSON.stringify(row.data)));
    samples.push(...relevant.map(row => ({ data: row.data, live: row.live, replay: row.replay, channel: row.channel, startDate: row.startDate })));
  }
  return body;
} });
const upcoming = candidates.filter(c => c.startUtcEpochSeconds * 1000 > Date.now());
const result = { checkedAt: new Date().toISOString(), requests, totalCandidates: candidates.length, upcoming: upcoming.length, samples, candidates: upcoming };
await writeFile('.bein-window-audit.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify({ requests, parsed: candidates.length, upcoming: upcoming.length, madridRows: samples.length, examples: upcoming.slice(0, 3) }, null, 2));
