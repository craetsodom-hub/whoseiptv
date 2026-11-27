import { createServer } from 'node:http'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { catalogHandler } from '../scripts/catalog/api.mjs'
import { isImageAsset } from '../scripts/catalog/logo-assets.mjs'
import { refreshCatalog } from '../scripts/catalog/refresh.mjs'
import { auditRelease } from '../scripts/catalog/release.mjs'
import { indexCatalog } from '../scripts/catalog/model.mjs'
import { parseAustralianOpen, parseNbaSeason } from '../scripts/catalog/season-expansion.mjs'
import { verifyMarketplaceLaunch } from '../scripts/verify-marketplace-launch.mjs'
import {
  addFormulaOneUkListings, addFormulaOneUsListings, applyCompletedPremierLeagueResults,
  applyPremierLeagueAmendments, parseFormulaOneUsPrices, parseSportsPrices, resolvePremierLeagueConflict
} from '../scripts/catalog/sources.mjs'

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
  const liveness = await request('/livez', 'invalid')
  assert.equal(liveness.status, 200)
  assert.deepEqual(await liveness.json(), { status: 'alive' })
  assert.equal((await request('/v1/fixtures?country=ZZ')).status, 400)
  assert.equal((await request('/v1/fixtures?generation=old')).status, 409)
  const result = await (await request('/v1/fixtures?sport=football&competition=league&season=league-2026&leagueCountry=ES&country=GB&limit=1')).json()
  assert.equal(result.total, 2)
  assert.equal(result.nextOffset, 1)
  const [listed] = result.data
  assert.equal(listed.participants[0].organization.logo.url, logo.url)
  assert.equal(listed.competition.logo.url, logo.url)
  assert.equal(listed.competition.organizer.logo.url, logo.url)
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

test('checks each RapidAPI tier and caps the test Apify export', async () => {
  const env = {
    CATALOG_PUBLIC_URL: 'https://catalog.example.test', CATALOG_TOKEN: 'origin-test',
    CATALOG_TEST_FIXTURE_ID: 'first', CATALOG_TEST_COUNTRY: 'GB', RAPIDAPI_HOST: 'example.p.rapidapi.com',
    RAPIDAPI_FREE_KEY: 'free-test', RAPIDAPI_PRO_KEY: 'pro-test', RAPIDAPI_ULTRA_KEY: 'ultra-test',
    APIFY_ACTOR_ID: 'owner~actor', APIFY_TOKEN: 'actor-test', APIFY_TEST_MAX_USD: '0.25'
  }
  const sample = {
    ...fixture, competitionId: 'league', country: 'GB', scheduleStatus: 'current', broadcastStatus: 'listed',
    competition: { ...catalog().competitions[0], organizer: catalog().organizations[1] },
    participants: [{ role: 'home', organization: { id: 'club', name: 'Home', logo } }],
    broadcasts: [{
      ...fixture.broadcasts[0], airtimeStatus: 'published', priceStatus: 'verified', offers: [catalog().offers[0]]
    }]
  }
  const checks = []
  const request = async (endpoint, options) => {
    const url = new URL(endpoint)
    const headers = new Headers(options.headers)
    assert.equal(options.redirect, 'error')
    if (url.hostname === 'catalog.example.test') {
      if (url.pathname === '/healthz') {
        checks.push('readiness')
        assert.equal(headers.get('Authorization'), 'Bearer origin-test')
        return Response.json({ status: 'ready' })
      }
      assert.equal(url.pathname + url.search, '/v1/fixtures/first?country=GB')
      if (!headers.has('Authorization')) {
        checks.push('anonymous')
        return Response.json({}, { status: 401 })
      }
      assert.equal(headers.get('Authorization'), 'Bearer origin-test')
      checks.push('origin fixture')
      return Response.json({ data: sample })
    }
    if (url.hostname === env.RAPIDAPI_HOST) {
      const key = headers.get('X-RapidAPI-Key')
      const quotas = { 'free-test': 100, 'pro-test': 10000, 'ultra-test': 50000 }
      assert.equal(url.pathname + url.search, '/v1/fixtures/first?country=GB')
      assert.equal(headers.get('X-RapidAPI-Host'), env.RAPIDAPI_HOST)
      assert.equal(headers.has('Authorization'), false)
      checks.push(key)
      return Response.json({ data: sample }, { headers: { 'x-ratelimit-requests-limit': quotas[key] } })
    }
    assert.equal(url.origin, 'https://api.apify.com')
    assert.equal(url.pathname, '/v2/actors/owner~actor/run-sync-get-dataset-items')
    assert.equal(url.searchParams.get('maxTotalChargeUsd'), '0.25')
    assert.equal(options.method, 'POST')
    assert.equal(headers.get('Authorization'), 'Bearer actor-test')
    assert.deepEqual(JSON.parse(options.body), {
      country: 'GB', season: 'league-2026', from: fixture.date, to: fixture.date, broadcastsOnly: true, maxRecords: 30
    })
    checks.push('export')
    return Response.json([sample])
  }

  assert.deepEqual(await verifyMarketplaceLaunch(env, request), {
    origin: 'passed', rapidapi: ['Basic', 'Pro', 'Ultra'], apify: 'passed', fixtureId: 'first', country: 'GB'
  })
  assert.deepEqual(checks, ['readiness', 'anonymous', 'origin fixture', 'free-test', 'pro-test', 'ultra-test', 'export'])

  checks.length = 0
  await assert.rejects(verifyMarketplaceLaunch({ ...env, RAPIDAPI_PRO_LIMIT: '999' }, request), /RapidAPI Pro.*quota/)
  assert.deepEqual(checks, ['readiness', 'anonymous', 'origin fixture', 'free-test', 'pro-test'])

  await assert.rejects(verifyMarketplaceLaunch(env, async (endpoint) => {
    assert.equal(endpoint, 'https://catalog.example.test/healthz')
    return Response.json({}, { status: 503 })
  }), /Hosted API readiness returned HTTP 503/)
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
  const base = parseSportsPrices(pricingPage(plans), evidence)
  assert.deepEqual(base.map(row => [row.country, row.amountMinor]), [['GB', 1499], ['GB', 3499]])
  assert(base.every(row => !row.destinationIds.includes('sky-sports-plus')))
  const entitlements = '<h3>All Sky Sports Membership</h3><p>All 12 Sky Sports channels: Main Event, Plus, F1</p>' +
    '<h3>Day Membership</h3><p>Everything you get with All Sky Sports Membership, for one day.</p>'
  assert(parseSportsPrices(pricingPage(plans), evidence, entitlements).every(row =>
    row.destinationIds.includes('sky-sports-plus') && row.entitlementSourceUrl))
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

test('release audit fails on incomplete fields, geography, stale prices and broken logos', () => {
  const now = Date.parse('2026-11-27T11:00:00.000Z')
  const original = catalog()
  original.organizations[1].logo = null
  const result = auditRelease(indexCatalog(original), { now, worldwide: true, logoResults: new Map([[logo.url, false]]) })
  assert.equal(result.ready, false)
  assert.equal(result.issues.missing_organization_logo.count, 1)
  assert.equal(result.issues.invalid_logo_asset.count, 1)
  assert.equal(result.issues.unconfirmed_start.count, 1)
  assert.equal(result.issues.missing_exact_airing.count, 2)
  assert.equal(result.issues.missing_airtime.count, 1)
  assert.equal(result.issues.missing_current_price.count, 2)
  assert(result.issues.missing_market.count > 0)
  assert(result.issues.missing_sport.examples.includes('basketball'))
})

test('keeps unannounced and missing seasons visible in the worldwide audit', async t => {
  const now = Date.parse('2026-11-27T10:00:00.000Z')
  const original = catalog()
  const tennis = parseAustralianOpen(
    '<p>set for Melbourne Park on 10-31 January</p><strong>Main-draw action at AO 2027 begins 17 January</strong>',
    '<img data-cmp-filereference="/assets/ao-brand-logo.svg">' +
      '{"logo":{"@type":"ImageObject","url":"https://www.tennis.com.au/assets/tennis-logo.svg"}}', '', evidence
  )
  for (const key of ['competitions', 'organizations', 'seasons', 'fixtures']) original[key].push(...tennis[key])
  original.seasons[0].expectedFixtureCount = 3
  original.competitionInventory = [{ ...evidence, country: 'AU', seasonIds: ['australian-open-2027', 'unloaded-season'] }]
  const index = indexCatalog(original)
  const result = auditRelease(index, { now, worldwide: true, includeDetails: true })
  assert.deepEqual(result.issues.incomplete_fixture_inventory.ids, ['league-2026', 'australian-open-2027'])
  assert.deepEqual(result.issues.missing_competition_season.ids, ['AU/unloaded-season'])
  assert.equal(result.issues.missing_competition_inventory.ids.length, result.issues.missing_competition_inventory.count)
  assert(result.issues.missing_competition_inventory.ids.includes('international'))

  const server = createServer(catalogHandler({ snapshot: () => index, clock: () => now }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const url = `http://127.0.0.1:${server.address().port}/v1/coverage`
  const { data } = await (await fetch(url)).json()
  assert.deepEqual(data.map(row => [row.fixtureCount, row.fixtureInventoryStatus, row.expectedFixtureCount]),
    [[2, 'partial', 3], [0, 'unannounced', undefined]])
})

test('a published NBA Cup date with undecided teams does not produce a kickoff or airtime', () => {
  const game = {
    homeTeam: { teamId: 1 }, awayTeam: { teamId: 2 }, gameDateEst: '2026-12-04T00:00:00Z',
    gameDateTimeUTC: '2026-12-05T00:00:00Z', gameStatus: 1, postponedStatus: 'N'
  }
  const nationalBroadcasters = [{ broadcasterDisplay: 'Peacock', broadcasterId: 99, localizationRegion: '' }]
  const games = Array.from({ length: 1205 }, (_, index) => ({
    ...game, gameId: '00226' + String(index + 1).padStart(5, '0')
  }))
  games.push({ ...game, gameId: '0022601230', homeTeam: { teamId: 0 }, awayTeam: { teamId: 0 },
    gameLabel: 'Emirates NBA Cup', gameSubLabel: 'Semifinal', gameStatusText: 'TBD', broadcasters: { nationalBroadcasters } })
  const schedule = { meta: { time: '2026-11-27T08:00:00.000Z' },
    leagueSchedule: { leagueId: '00', seasonYear: '2026-27', gameDates: [{ games }] } }
  const badges = Array.from({ length: 30 }, (_, index) =>
    `<img src="https://cdn.nba.com/logos/nba/${index + 1}/primary/L/logo.svg" title="Team ${index + 1} Logo">`)
  badges.push('<img src="https://cdn.nba.com/logos/leagues/logo-nba.svg" alt="NBA Logo">')
  const batch = parseNbaSeason(schedule, badges.join(''), evidence)
  const placeholder = batch.fixtures.at(-1)
  assert.equal(batch.seasons[0].expectedFixtureCount, 1230)
  assert.equal(placeholder.startStatus, 'unannounced')
  assert.equal(placeholder.startsAt, null)
  assert.deepEqual(placeholder.participants, [])
  assert.equal(placeholder.broadcasts[0].airsAt, null)
  assert.equal(placeholder.broadcasts[0].destinationId, 'peacock-us')
})

test('release audit accepts explicit no-airing evidence and never treats an empty market as proof', () => {
  const now = Date.parse('2026-11-27T10:00:00.000Z')
  const original = catalog()
  for (const row of original.fixtures) {
    row.participants.push({ organizationId: 'organizer', role: 'away' })
    row.startStatus = 'scheduled'
    row.startsAt ??= '2027-04-01T18:00:00.000Z'
  }
  original.fixtures[0].broadcasts.pop()
  const [gb, es] = original.seasons[0].markets
  es.expectedListedFixtureIds = []
  gb.noAiring = [{ ...evidence, fixtureId: 'second' }]
  es.noAiring = [{ ...evidence, fixtureId: 'first' }, { ...evidence, fixtureId: 'second' }]
  const options = { now, logoResults: new Map([[logo.url, true]]) }
  const ready = auditRelease(indexCatalog(original), options)
  assert.equal(ready.ready, true)
  assert.equal(ready.counts.explicitlyUnaired, 3)
  assert.equal(ready.validUntil, original.offers[0].validUntil)
  es.noAiring.pop()
  assert.equal(auditRelease(indexCatalog(original), options).issues.missing_exact_airing.count, 1)
  gb.noAiring.push({ ...evidence, fixtureId: 'first' })
  assert.throws(() => indexCatalog(original), /Conflicting no-airing evidence/)
})

test('logo asset validation requires an image response and an intact image envelope', () => {
  assert(isImageAsset(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/svg+xml'))
  assert(!isImageAsset(Buffer.from('<html>404</html>'), 'image/svg+xml'))
  assert(!isImageAsset(Buffer.from('<svg>'), 'image/svg+xml'))
  assert(!isImageAsset(Buffer.from('<svg></svg>'), 'text/html'))
})

test('a published kickoff amendment replaces the old time and clears mismatched listings', () => {
  const original = structuredClone(fixture)
  const batch = { fixtures: [original] }
  applyPremierLeagueAmendments(batch, [{ ...original, date: '2027-02-22',
    startsAt: '2027-02-22T20:00:00.000Z', broadcasts: [] }])
  assert.equal(original.startsAt, '2027-02-22T20:00:00.000Z')
  assert.equal(original.date, '2027-02-22')
  assert.deepEqual(original.broadcasts, [])
  assert.throws(() => applyPremierLeagueAmendments(batch, [{ ...original, id: 'unknown' }]), /outside the season/)
})

test('a completed result confirms a provisional kickoff only for the same season, teams and local date', () => {
  const kickoff = '2026-08-23T14:00:00Z'
  const entry = { season: { year: 2026 }, competitions: [{ date: kickoff, timeValid: true,
    status: { type: { state: 'post', completed: true } },
    competitors: ['home', 'away'].map(role => ({ homeAway: role, team: { displayName: role } })) }] }
  const organizations = ['home', 'away'].map(id => ({ id, kind: 'club', name: id }))
  const participants = organizations.map(team => ({ organizationId: team.id, role: team.id }))
  const batch = {
    organizations, fixtures: [
      { date: '2026-08-23', startStatus: 'provisional', participants },
      { date: '2026-08-24', startStatus: 'provisional', participants }
    ]
  }
  const results = new Map([['202608', { leagues: [{ slug: 'eng.1' }], events: [entry] }]])
  applyCompletedPremierLeagueResults(batch, results, Date.parse('2026-11-27'))
  assert.equal(batch.fixtures[0].startsAt, '2026-08-23T14:00:00.000Z')
  assert.equal(batch.fixtures[1].startStatus, 'provisional')
})

test('UK racing programme matches the named race and session at its independently published time', () => {
  const race = { id: 'qatar-qualifying', title: 'Qualifying - Qatar Grand Prix',
    startsAt: '2026-11-28T18:00:00.000Z', broadcasts: [] }
  const weekend = { seasons: [{ markets: [] }], fixtures: [race] }
  const html = '<h3>Sat 28th November</h3><div class="event-group"><strong>Qatar Airways Qatar GP - Qualifying 1</strong>' +
    '<p class="event-detail">Sky Sports F1 HD (18:00)</p></div>'
  addFormulaOneUkListings(weekend, [[evidence.sourceUrl, html]], evidence)
  assert.equal(race.broadcasts[0].country, 'GB')
  assert.equal(race.broadcasts[0].airsAt, race.startsAt)
  assert.deepEqual(weekend.seasons[0].markets[0].expectedListedFixtureIds, [race.id])
})

test('US racing airtime uses the live national feed and the local price is free only for practice', () => {
  const startsAt = '2026-11-29T16:00:00.000Z'
  const airsAt = '2026-11-29T14:50:00.000Z'
  const race = { id: 'qatar-race', title: 'Race - Qatar Grand Prix', startsAt, broadcasts: [] }
  const weekend = { seasons: [{ markets: [] }], fixtures: [race] }
  const eventTime = { gameKickOffStartTime: Date.parse(startsAt),
    playerInfoDisplayTime: { startTime: Date.parse(airsAt) }, liveBadgeTime: { startTime: Date.parse(airsAt) } }
  const channel = { leagueName: 'Formula 1', feedName: 'Main Broadcast', airingType: 'Live', shortTitle: 'Qatar: Race',
    eventTime, url: 'https://tv.apple.com/us/sporting-event/qatar-race/umc.cse.abc?ignored=1',
    playables: [{ externalServiceId: 'com.apple.f1.svod.ebs.US', externalId: 'F1_123_NATIONAL', eventTime }] }
  const html = value => `<script id="serialized-server-data">${JSON.stringify(value)}</script>`
  addFormulaOneUsListings(weekend, html({ ...channel, airingType: 'OnDemand' }), evidence)
  assert.equal(race.broadcasts.length, 0)
  addFormulaOneUsListings(weekend, html(channel), evidence)
  assert.equal(race.broadcasts[0].airsAt, airsAt)
  assert.equal(race.broadcasts[0].country, 'US')
  const practice = { ...race, id: 'qatar-practice', title: 'Practice 1 - Qatar Grand Prix' }
  const subscription = 'every Free Practice, Qualifying session, Sprint, and Grand Prix available to Apple TV subscribers in the U.S.'
  const plans = parseFormulaOneUsPrices('A monthly subscription is just $14.99 per month.',
    subscription + ' Every practice is available without a subscription.', evidence, [race, practice])
  assert.equal(plans[0].amountMinor, 1499)
  assert.equal(plans[1].billingPeriod, 'free')
  assert.deepEqual(plans[1].fixtureIds, [practice.id])
})

test('refresh promotes complete candidates and preserves the published file on denial or failure', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'whoseiptv-refresh-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'catalog.json')
  const previous = 'previous verified snapshot'
  const data = JSON.stringify(catalog())
  await writeFile(path, previous)
  const build = candidate => writeFile(candidate, data)
  const validUntil = new Date(Date.now() + 60_000).toISOString()

  const blocked = await refreshCatalog({ path, build, verify: async () => ({ ready: false }) })
  assert.equal(blocked.outcome, 'blocked')
  assert.equal(await readFile(path, 'utf8'), previous)

  await assert.rejects(refreshCatalog({ path, build: async () => { throw new Error('Source unavailable') } }),
    /Source unavailable/)
  assert.equal(await readFile(path, 'utf8'), previous)
  await assert.rejects(refreshCatalog({ path, build, verify: async () => ({ ready: true, validUntil: null }) }),
    /Candidate expired/)
  assert.equal(await readFile(path, 'utf8'), previous)

  const controller = new AbortController()
  await assert.rejects(refreshCatalog({
    path, build, signal: controller.signal, verify: async () => {
      controller.abort()
      return { ready: true, validUntil }
    }
  }), { name: 'AbortError' })
  assert.equal(await readFile(path, 'utf8'), previous)

  const published = await refreshCatalog({
    path, build, worldwide: true, verify: async (index, options) => {
      assert.equal(index.fixtures.size, 2)
      assert.equal(options.worldwide, true)
      return { ready: true, validUntil }
    }
  })
  assert.equal(published.outcome, 'published')
  assert.equal(await readFile(path, 'utf8'), data)
  assert.deepEqual(await readdir(directory), ['catalog.json'])
})
