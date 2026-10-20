import { readFile, writeFile } from 'node:fs/promises';
const feed = JSON.parse(await readFile('feed/events/v1/events.json', 'utf8'));
const event = feed.events.find(e => e.sourceIds?.thesportsdb && e.startUtcEpochSeconds * 1000 > Date.now());
if (!event) throw new Error('No current event ID to probe');
const key = process.env.THESPORTSDB_API_KEY || '123';
const response = await fetch(`https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(key)}/lookuptv.php?id=${event.sourceIds.thesportsdb}`, { signal: AbortSignal.timeout(15000) });
console.log(JSON.stringify({ event: event.title, id: event.sourceIds.thesportsdb, status: response.status, credential: key === '123' ? 'development' : 'configured', retryAfter: response.headers.get('retry-after') }));
if (response.ok) { const payload = await response.json(); await writeFile('.event-tv-probe.json', JSON.stringify({ event, payload }, null, 2)); console.log(JSON.stringify(payload)); }
