import { createServer } from 'node:http'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { catalogHandler } from '../scripts/catalog/api.mjs'
import { indexCatalog } from '../scripts/catalog/model.mjs'
import { parseSportsPrices, resolvePremierLeagueConflict } from '../scripts/catalog/sources.mjs'

const evidence = {
  sourceUrl: 'https://example.org/schedule',
  verifiedAt: '2026-11-27T09:00:00.000Z',
  validUntil: '2026-11-28T09:00:00.000Z'
}
const logo = { url: 'https://example.org/club.svg', sourceUrl: evidence.sourceUrl }
const fixture = {
  id: 'first', seasonId: 'league-2026', title: 'Home v Away', date: '2027-02-21',
  startsAt: '2027-02-21T19:30:00.000Z', startStatus: 'scheduled', sourceUrl: evidence.sourceUrl,
  participants: [{ organizationId: 'club', role: 'home' }],
  broadcasts: [
    { ...evidence, country: 'GB', destinationId: 'channel', name: 'Sports channel', type: 'channel',
      kind: 'live', airsAt: '2027-02-21T18:30:00.000Z' },
    { ...evidence, country: 'ES', destinationId: 'channel', name: 'Sports channel', type: 'channel',
      kind: 'live', airsAt: null }
  ]
}
function catalog() {
  return {
    schemaVersion: 1, generatedAt: evidence.verifiedAt,
    organizations: [
      { id: 'club', name: 'Home', kind: 'club', country: 'ES', logo },
      { id: 'organizer', name: 'Organizer', kind: 'federation', country: 'ES', logo }
    ],
    competitions: [{ id: 'league', sport: 'football', kind: 'league', name: 'League', leagueCountry: 'ES',
      organizerId: 'organizer', logo }],
    seasons: [{
      ...evidence, id: 'league-2026', label: '2026/27', competitionId: 'league', startsOn: '2026-08-01',
      endsOn: '2027-06-30', expectedFixtureIds: ['first', 'second'],
      markets: ['GB', 'ES'].map(country => ({ ...evidence, country, expectedListedFixtureIds: ['first'] }))
    }],
    fixtures: [structuredClone(fixture), { ...fixture, id: 'second', date: '2027-04-01',
      startsAt: null, startStatus: 'unannounced', broadcasts: [] }],
    offers: [{ ...evidence, id: 'uk-price', country: 'GB', provider: 'Provider',
      plan: 'Monthly', currency: 'GBP', amountMinor: 2499, billingPeriod: 'month',
      competitionIds: ['league'], destinationIds: ['channel'], validUntil: '2026-11-27T11:00:00.000Z' }]
  }
}

test('reconciles inventory and rejects missing fixtures, market listings and invalid dates', () => {
  const validCatalog = catalog()
  assert.equal(indexCatalog(validCatalog).fixtures.size, 2)
  const missing = catalog()
  missing.fixtures.pop()
  assert.throws(() => indexCatalog(missing), /Incomplete or inconsistent fixture/)
  const unlisted = catalog()
  unlisted.fixtures[0].broadcasts.pop()
  assert.throws(() => indexCatalog(unlisted), /Incomplete or inconsistent listed fixture/)
  const badDate = catalog()
  badDate.fixtures[0].startsAt = '2027-02-30T19:30:00.000Z'
  assert.throws(() => indexCatalog(badDate), /Invalid start time/)
})

test('filters by distinct league and broadcast countries and suppresses expired or cross-market prices', async t => {
  let now = Date.parse('2026-11-27T10:00:00.000Z')
  const index = indexCatalog(catalog())
  const server = createServer(catalogHandler({ snapshot: () => index, clock: () => now, token: 'test-token' }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const request = (path, token = 'test-token') => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  assert.equal((await request('/v1/fixtures', 'invalid')).status, 401)
  assert.equal((await request('/v1/fixtures?country=ZZ')).status, 400)
  assert.equal((await request('/v1/fixtures?generation=old')).status, 409)
  const result = await (await request('/v1/fixtures?sport=football&competition=league&season=league-2026&leagueCountry=ES&country=GB&limit=1')).json()
  assert.equal(result.total, 2)
  assert.equal(result.nextOffset, 1)
  const [listed] = result.data
  assert.equal(listed.participants[0].organization.logo.url, logo.url)
  assert.equal(listed.broadcasts.length, 1)
  assert.equal(listed.broadcasts[0].offers[0].amountMinor, 2499)
  assert.notEqual(listed.startsAt, listed.broadcasts[0].airsAt)
  const { data } = await (await request('/v1/fixtures/first?country=ES')).json()
  assert.equal(data.broadcasts[0].priceStatus, 'unverified')
  assert.equal(data.broadcasts[0].airtimeStatus, 'not_published')
  assert.deepEqual(data.broadcasts[0].offers, [])
  const only = await (await request('/v1/fixtures?country=GB&broadcastsOnly=true')).json()
  assert.equal(only.total, 1)
  const absent = await (await request('/v1/coverage?country=FR')).json()
  assert.equal(absent.data[0].marketStatus, 'not_covered')
  now = Date.parse('2026-11-27T11:00:00.000Z')
  const expired = await (await request('/v1/fixtures/first?country=GB')).json()
  assert.equal(expired.data.broadcasts[0].priceStatus, 'stale')
  assert.deepEqual(expired.data.broadcasts[0].offers, [])
  now = Date.parse(evidence.validUntil)
  const staleSchedule = await (await request('/v1/fixtures/first?country=GB')).json()
  assert.equal(staleSchedule.data.scheduleStatus, 'stale')
  assert.equal(staleSchedule.data.broadcastStatus, 'stale')
  assert.deepEqual(staleSchedule.data.broadcasts, [])
})

test('uses a matching dated source to resolve a duplicated fixture', () => {
  const team = (displayName, homeAway) => ({ homeAway, team: { displayName } })
  const choices = [
    { ...fixture, date: '2027-02-21', startsAt: '2027-02-21T19:30:00.000Z' },
    { ...fixture, date: '2027-02-22', startsAt: '2027-02-22T20:00:00.000Z' }
  ].map(row => ({ ...row, participants: [
    { organizationId: 'club-home', role: 'home' }, { organizationId: 'club-away', role: 'away' }
  ] }))
  const scoreboard = new Map([['202702', { events: [{
    date: '2027-02-22T20:00Z', competitions: [{ competitors: [team('Home', 'home'), team('Away', 'away')] }]
  }] }]])
  assert.equal(resolvePremierLeagueConflict(choices, scoreboard).date, '2027-02-22')
  assert.throws(() => resolvePremierLeagueConflict(choices, new Map()), /Conflicting published kickoff/)
})

test('extracts the named country-specific plan SKUs and rejects contradictory prices', () => {
  const plans = [
    { productId: 'SPORTS_PASS_DAY', offerPrice: '£14.99' },
    { productId: 'ALL_SKY_SPORTS_MONTH_BUNDLE', offerPrice: '£34.99' }
  ]
  const pricingPage = rows => {
    const data = JSON.stringify({ fetchPage: { atom: { atomConfig: { gb: {} } }, content: { rows } } })
    return 'Sports Day Membership gives you instant access to all of Sky Sports for 24 hours ' +
      'What do I get with a NOW All Sky Sports Membership' +
      `<script id="__NEXT_DATA__">${JSON.stringify({ props: { graphqlState: { data: { page: { data } } } } })}</script>`
  }
  assert.deepEqual(parseSportsPrices(pricingPage(plans), evidence).map(row => [row.country, row.amountMinor]),
    [['GB', 1499], ['GB', 3499]])
  assert.throws(() => parseSportsPrices(pricingPage([...plans, { ...plans[0], offerPrice: '£20.00' }]), evidence),
    /conflicting UK price/)
})

test('keeps the programme start separate from the kickoff in a matched source row', async () => {
  const { parseSkyFixtureSchedule } = await import('../scripts/broadcast/sky-fixtures.mjs')
  const html = '<h3>Fri 27th November</h3><div class="event-group"><strong>Home</strong>' +
    '<strong>Away</strong><li class="col2">20:00</li>' +
    '<p class="event-detail">Sky Sports Premier League (19:00), Sky Sports Main Event (19:15)</p></div>'
  const [candidate] = parseSkyFixtureSchedule(html, {}, new Date(evidence.verifiedAt), { includeAirtimes: true })
  assert.equal(candidate.startUtcEpochSeconds * 1000, Date.parse('2026-11-27T20:00Z'))
  assert.deepEqual(candidate.broadcasts.map(row => row.airsAtUtcEpochSeconds * 1000),
    [Date.parse('2026-11-27T19:00Z'), Date.parse('2026-11-27T19:15Z')])
})
