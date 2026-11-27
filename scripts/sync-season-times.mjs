import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { indexCatalog, isFresh } from './catalog/model.mjs'

export function seasonTimes(index, previous, now = Date.now()) {
  const prior = new Map((previous?.seasons ?? []).map(season => [season.id, season]))
  const seasons = new Map([...prior].filter(([, season]) => Date.parse(season.validUntil) > now))
  let refreshed = 0
  for (const season of index.seasons.values()) {
    if (season.timeSyncUnavailable || !isFresh(season, now)) continue
    const last = prior.get(season.id)
    if (last && Date.parse(last.checkedAt) > Date.parse(season.verifiedAt)) continue
    const older = new Map((last?.events ?? []).map(row => [row.id, row]))
    const competition = index.competitions.get(season.competitionId)
    const events = [...season.expectedFixtureIds].sort().map(id => {
      const fixture = index.fixtures.get(id)
      const status = fixture.startStatus
      const startsAt = status === 'scheduled' ? new Date(fixture.startsAt).toISOString() : null
      const old = older.get(id)
      const changedAt = old?.status === status && old.startsAt === startsAt && old.date === fixture.date
        ? old.changedAt : season.verifiedAt
      return { id, title: fixture.title, date: fixture.date, status, startsAt, changedAt, sourceUrl: fixture.sourceUrl }
    })
    seasons.set(season.id, { id: season.id, sport: competition.sport, competition: competition.id,
      checkedAt: season.verifiedAt, validUntil: season.validUntil, events })
    refreshed++
  }
  if (!refreshed) throw new Error('No season returned a current schedule')
  return { schemaVersion: 1, generatedAt: index.generatedAt,
    seasons: [...seasons.values()].sort((a, b) => a.id.localeCompare(b.id)) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output] = process.argv.slice(2)
  if (!input || !output) throw new Error('Supply the catalog and destination JSON paths')
  const index = indexCatalog(JSON.parse(await readFile(input, 'utf8')))
  let previous
  try {
    previous = JSON.parse(await readFile(output, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const feed = seasonTimes(index, previous)
  await mkdir(dirname(output), { recursive: true })
  const temporary = output + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(temporary, JSON.stringify(feed, null, 2) + '\n', { flag: 'wx' })
    await rename(temporary, output)
  } finally {
    await rm(temporary, { force: true })
  }
  const records = feed.seasons.flatMap(row => row.events)
  console.log('Published ' + records.filter(row => row.startsAt).length + ' confirmed times across ' + records.length + ' event records.')
}
