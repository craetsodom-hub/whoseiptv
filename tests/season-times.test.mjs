import assert from 'node:assert/strict'
import test from 'node:test'
import { seasonTimes } from '../scripts/sync-season-times.mjs'

const start = '2026-11-27T12:00:00.000Z'
const later = '2026-11-27T13:00:00.000Z'
function snapshot(status, startsAt, checkedAt = start) {
  const season = { id: 'edition', competitionId: 'cup', expectedFixtureIds: ['game'],
    verifiedAt: checkedAt, validUntil: '2026-11-28T12:00:00.000Z' }
  return { generatedAt: checkedAt, seasons: new Map([[season.id, season]]),
    competitions: new Map([['cup', { id: 'cup', sport: 'football' }]]),
    fixtures: new Map([['game', { id: 'game', title: 'A v B', date: '2026-12-01',
      sourceUrl: 'https://example.org/game', startStatus: status, startsAt }]]) }
}
const row = result => result.seasons[0].events[0]
test('publishes confirmations, corrections and withdrawals under the same client ID', () => {
  const kickoff = '2026-12-01T18:30:00.000Z'
  const pending = seasonTimes(snapshot('provisional', kickoff), null, Date.parse(start))
  assert.equal(row(pending).startsAt, null)
  const confirmed = seasonTimes(snapshot('scheduled', kickoff, later), pending, Date.parse(later))
  assert.deepEqual([row(confirmed).id, row(confirmed).startsAt, row(confirmed).changedAt], ['game', kickoff, later])
  const corrected = seasonTimes(snapshot('scheduled', '2026-12-01T19:30:00Z', later), confirmed, Date.parse(later))
  assert.equal(row(corrected).startsAt, '2026-12-01T19:30:00.000Z')
  const withdrawn = seasonTimes(snapshot('postponed', null, later), corrected, Date.parse(later))
  assert.equal(row(withdrawn).startsAt, null)
  assert.equal(row(withdrawn).status, 'postponed')
  const same = seasonTimes(snapshot('scheduled', kickoff, later), confirmed, Date.parse(later))
  assert.deepEqual(row(same), row(confirmed))
})

test('carries unavailable seasons only through their own expiry', () => {
  const previous = seasonTimes(snapshot('scheduled', later), null, Date.parse(start))
  previous.seasons.push({ id: 'offline', events: [], checkedAt: start, validUntil: '2026-11-27T13:30:00Z' })
  const value = snapshot('scheduled', later, later)
  const first = seasonTimes(value, previous, Date.parse(later))
  assert.deepEqual(first.seasons.find(s => s.id === 'offline'), previous.seasons[1])
  assert.equal(seasonTimes(value, first, Date.parse('2026-11-27T13:31:00Z')).seasons.length, 1)
  value.seasons.get('edition').timeSyncUnavailable = true
  assert.throws(() => seasonTimes(value, previous, Date.parse(later)), /No season returned/)
})

test('a matching league and broadcaster listing confirms a future kickoff and the league can withdraw it', async () => {
  const { applyLivePremierLeagueTimes } = await import('../scripts/catalog/sources.mjs')
  const organizations = Array.from({ length: 20 }, (_, i) => ({ kind: 'club', name: 'Club ' + i, id: 'club-' + i }))
  const teams = organizations.map((club, i) => ({ name: club.name, id: i + 1 }))
  const roster = { teams, events: [{ deadline_time: '2027-05-30T13:00:00Z' }] }
  const fixture = { date: '2026-12-01', startStatus: 'provisional', startsAt: '2026-12-01T15:00:00Z', broadcasts: [],
    participants: [{ role: 'home', organizationId: 'club-0' }, { role: 'away', organizationId: 'club-1' }] }
  const season = { startsOn: '2026-08-01', endsOn: '2027-05-31', expectedFixtureIds: ['first'] }
  const batch = { seasons: [season], organizations, fixtures: [fixture] }
  const newTime = '2026-12-01T20:00:00Z'
  const game = { team_h: 1, team_a: 2, kickoff_time: newTime, provisional_start_time: false }
  const listing = { homeTeam: 'Club 0', awayTeam: 'Club 1', startUtcEpochSeconds: Date.parse(newTime) / 1000,
    sourceUrl: 'https://example.org/broadcast' }
  const evidence = { verifiedAt: start }
  applyLivePremierLeagueTimes(batch, [game], roster, [], evidence)
  assert.equal(fixture.startsAt, null)
  applyLivePremierLeagueTimes(batch, [game], roster, [listing], evidence)
  assert.equal(fixture.startStatus, 'scheduled')
  assert.equal(fixture.startsAt, '2026-12-01T20:00:00.000Z')
  applyLivePremierLeagueTimes(batch, [{ ...game, kickoff_time: null }], roster, [listing], evidence)
  assert.equal(fixture.startStatus, 'unannounced')
  assert.equal(fixture.startsAt, null)
})

test('US Prime pricing only applies to games explicitly carried by Prime Video in that country', async () => {
  const { nbaPrimeOffers } = await import('../scripts/catalog/season-expansion.mjs')
  const text = '<title>2026-27 NBA season on Prime Video</title><p>Prime Video is included with a Prime membership, which costs $14.99 a month or $139 a year.</p>'
  const batch = { fixtures: [{ broadcasts: [
    { name: 'Prime Video', type: 'service', country: 'US', destinationId: 'prime-us' },
    { name: 'Prime Video', type: 'service', country: 'DE', destinationId: 'prime-de' },
    { name: 'ESPN', type: 'channel', country: 'US', destinationId: 'espn-us' }
  ] }] }
  const prices = nbaPrimeOffers(batch, text, {})
  assert.deepEqual(prices.map(p => p.amountMinor), [1499, 13900])
  assert(prices.every(p => p.country === 'US' && p.destinationIds.join() === 'prime-us'))
  assert.deepEqual(nbaPrimeOffers(batch, text.replace('2026-27', '2024-25'), {}), [])
})
