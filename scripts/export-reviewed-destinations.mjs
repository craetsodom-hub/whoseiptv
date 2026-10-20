// Export this shared catalog to a consumer. No network calls or feed publication.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { activeAllEventDestinations, validateRightsCatalog } from './broadcast/rights-catalog.mjs';
const raw = await readFile(new URL('../config/official-event-broadcasters.json', import.meta.url), 'utf8');
const config = JSON.parse(raw);
const audioRaw = await readFile(new URL('../config/channel-audio-evidence.json', import.meta.url), 'utf8');
validateRightsCatalog(config);
if (!process.argv[2]) throw new Error('Supply an output JSON path');
const rules = activeAllEventDestinations(config);
// Expiry derives from the human source review, never from the export clock.
const destinations = rules.map(rule => ({ ...rule, reviewValidUntil: new Date(Date.parse(`${rule.lastVerified}T00:00:00Z`) + 90 * 86400000).toISOString() }));
await writeFile(process.argv[2], JSON.stringify({ sourceRepository: 'craetsodom-hub/whoseiptv', sourceFile: 'config/official-event-broadcasters.json', sourceSha256: createHash('sha256').update(raw).digest('hex'), allEventDestinations: destinations,
  channelAudioSourceFile: 'config/channel-audio-evidence.json', channelAudioSourceSha256: createHash('sha256').update(audioRaw).digest('hex'), channelAudioEvidence: JSON.parse(audioRaw).rules }, null, 2) + '\n');
console.log(`Exported ${destinations.length} reviewed rules across ${new Set(destinations.map(r => r.territory)).size} territories.`);
