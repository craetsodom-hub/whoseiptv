import { readFile } from 'node:fs/promises'

const territory = String(process.argv[2] ?? '').trim().toUpperCase()
if (!/^[A-Z]{2}$/.test(territory)) {
  console.error('Usage: node scripts/audit-territory.mjs <ISO alpha-2 territory>')
  process.exit(2)
}

const feed = JSON.parse(await readFile(new URL('../feed/events/v1/events.json', import.meta.url), 'utf8'))
const events = Array.isArray(feed.events) ? feed.events : []
const officialTypes = new Set(['official-event', 'official-broadcaster-schedule'])
const appliesToTerritory = item => item?.territory === territory || (Array.isArray(item?.territories) && item.territories.includes(territory))
const rows = events.map(event => {
  const local = (Array.isArray(event.broadcasts) ? event.broadcasts : []).filter(item => appliesToTerritory(item) && item?.confirmed === true)
  const official = local.filter(item => officialTypes.has(item.sourceType) && (item.destinationPrecision ?? 'channel') === 'channel')
  return {
    id: event.id,
    title: event.title,
    competition: event.competition ?? null,
    startsAt: new Date(Number(event.startUtcEpochSeconds) * 1000).toISOString(),
    exactChannels: official.map(item => item.channelName),
    otherPublishedDestinations: local.filter(item => !official.includes(item)).map(item => ({ channel: item.channelName, sourceType: item.sourceType }))
  }
})

const exact = rows.filter(row => row.exactChannels.length > 0)
const published = rows.filter(row => row.exactChannels.length > 0 || row.otherPublishedDestinations.length > 0)
console.log(JSON.stringify({
  territory,
  generatedAtEpochSeconds: feed.generatedAtEpochSeconds ?? null,
  validUntilEpochSeconds: feed.validUntilEpochSeconds ?? null,
  events: rows.length,
  eventsWithOfficialExactChannel: exact.length,
  eventsWithAnyPublishedDestination: published.length,
  officialExactCoveragePercent: rows.length ? Number((exact.length / rows.length * 100).toFixed(1)) : 0,
  exact,
  gaps: rows.filter(row => row.exactChannels.length === 0)
}, null, 2))
