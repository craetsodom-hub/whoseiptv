// Apply only territory-specific official offers captured in the research report.
import { readFile, writeFile } from 'node:fs/promises';
import { validateRightsCatalog } from './broadcast/rights-catalog.mjs';
const path = new URL('../config/official-event-broadcasters.json', import.meta.url);
const config = JSON.parse(await readFile(path, 'utf8'));
const research = JSON.parse(await readFile(new URL('../../whoplaysnow-clean/docs/MLS-TERRITORY-RESEARCH.json', import.meta.url), 'utf8'));
const reviewed = research.filter(r => r.status === 200 && r.finalUrl === r.url && r.evidence.some(text => /Every MLS match/i.test(text)));
const mls = config.competitions.find(c => c.id === 'mls');
for (const row of reviewed) {
  mls.allEventDestinations ??= [];
  if (mls.allEventDestinations.some(d => d.territory === row.country && d.name === 'Apple TV')) continue;
  mls.allEventDestinations.push({ territory: row.country, name: 'Apple TV', aliases: ['Apple TV+'], seasons: ['2026'], validFrom: '2026-02-01', validThrough: '2026-12-31', sourceUrl: row.url, allMatches: true, allMatchesEvidenceUrl: row.url, viewingUrl: row.url, lastVerified: '2026-10-18' });
}
for (const id of ['uefa-champions-league', 'uefa-europa-league', 'uefa-conference-league']) {
  const competition = config.competitions.find(c => c.id === id);
  competition.allEventDestinations ??= [];
  if (competition.allEventDestinations.some(d => d.territory === 'AU' && d.name === 'Stan Sport')) continue;
  const url = 'https://www.stan.com.au/watch/sport/football/uefa-champions-league';
  competition.allEventDestinations.push({ territory: 'AU', name: 'Stan Sport', aliases: [], seasons: ['2026/27'], validFrom: '2026-07-01', validThrough: '2027-06-30', sourceUrl: url, allMatches: true, allMatchesEvidenceUrl: url, lastVerified: '2026-10-18' });
}
validateRightsCatalog(config);
await writeFile(path, JSON.stringify(config, null, 2) + '\n');
console.log('Reviewed MLS territories:', reviewed.map(r => r.country).sort().join(', '));
