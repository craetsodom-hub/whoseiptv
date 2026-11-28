import test from 'node:test'
import assert from 'node:assert/strict'
import { nhlPrimeOffers } from '../scripts/catalog/nhl.mjs'

test('NHL membership prices attach only to Canadian Prime games with matching season evidence', () => {
  const pricing = 'A Prime membership is $9.99 per month, or $99 per year if you pay annually, plus applicable taxes.'
  const rights = '2026-2027 NHL on Prime schedule at no additional cost to Prime members in Canada'
  const fixtures = ['CA', 'US'].map(country => ({ id: country.toLowerCase(),
    broadcasts: [{ country, name: 'Prime', type: 'service', destinationId: 'prime-' + country.toLowerCase() }] }))
  const offers = nhlPrimeOffers(fixtures, pricing, rights, {})
  assert.deepEqual(offers.map(o => [o.amountMinor, o.currency, o.fixtureIds]), [[999, 'CAD', ['ca']], [9900, 'CAD', ['ca']]])
  assert.deepEqual(nhlPrimeOffers(fixtures, pricing, rights.replace('2027', '2028'), {}), [])
  assert.deepEqual(nhlPrimeOffers(fixtures, '', rights, {}), [])
})

test('NHL cross-checks both schedules and withdraws conflicting or postponed times', async () => {
  const { loadNhlSeason, nhlRoster } = await import('../scripts/catalog/nhl.mjs')
  const codes = Array.from({ length: 32 }, (_, i) =>
    'A' + String.fromCharCode(65 + Math.floor(i / 26), 65 + i % 26))
  const standings = codes.map(code => ({ teamAbbrev: { default: code }, seasonId: 20262027,
    teamName: { default: code }, teamLogo: 'https://assets.nhle.com/logos/nhl/svg/' + code + '.svg' }))
  const schedules = new Map(codes.map(code => [code, []]))
  for (let i = 0; i < codes.length; i += 2) {
    for (let n = 0; n < 84; n++) {
      const id = 2026020001 + i / 2 * 84 + n
      const game = { id, season: 20262027, gameType: 2, gameDate: '2026-11-27', gameScheduleState: 'OK',
        startTimeUTC: '2026-11-28T01:00:00Z', homeTeam: { abbrev: codes[i] }, awayTeam: { abbrev: codes[i+1] } }
      schedules.get(codes[i]).push(game)
      schedules.get(codes[i+1]).push({ ...game })
    }
  }
  schedules.get(codes[1])[0].startTimeUTC = '2026-11-28T02:00:00Z'
  schedules.get(codes[0])[1].gameScheduleState = 'PPD'
  const get = async url => url === nhlRoster ? { standings } : { games: schedules.get(url.split('/').at(-2)) }
  const batch = await loadNhlSeason(get, {})
  assert.equal(batch.fixtures.length, 1344)
  assert.deepEqual(batch.fixtures.slice(0, 3).map(r => [r.startStatus, r.startsAt]),
    [['unannounced', null], ['postponed', null], ['scheduled', '2026-11-28T01:00:00Z']])
  schedules.get(codes[0]).pop()
  await assert.rejects(loadNhlSeason(get, {}), /Incomplete NHL schedule/)
})
