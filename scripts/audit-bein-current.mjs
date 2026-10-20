import { writeFile } from 'node:fs/promises';
import { BEIN_MENA_API_URL, BEIN_MENA_URL, parseBeinMenaApi, parseBeinMenaGuide } from './broadcast/adapters/bein-mena.mjs';
const results = [];
for (const url of [BEIN_MENA_API_URL, BEIN_MENA_URL]) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) { results.push({ url, status: response.status, retryAfter: response.headers.get('retry-after') }); continue; }
    const body = await response.text();
    const rows = url === BEIN_MENA_URL ? parseBeinMenaGuide(body) : parseBeinMenaApi(body);
    const upcoming = rows.filter(r => r.startUtcEpochSeconds * 1000 > Date.now());
    results.push({ url, status: response.status, count: url === BEIN_MENA_URL ? undefined : JSON.parse(body).count, parsed: rows.length, upcoming: upcoming.length, samples: upcoming.slice(0, 12).map(({ broadcastsFor, ...r }) => r), madrid: rows.filter(r => /madrid|sevilla/i.test(`${r.homeTeam} ${r.awayTeam}`)).map(({ broadcastsFor, ...r }) => r) });
  } catch (e) { results.push({ url, error: e.message }); }
}
await writeFile('.bein-current-audit.json', JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
console.log(JSON.stringify(results, null, 2));
