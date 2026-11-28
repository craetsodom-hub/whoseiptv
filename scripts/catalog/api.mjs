import { timingSafeEqual } from 'node:crypto'
import { isDate, isFresh, isId } from './model.mjs'
import { isSupportedTerritory } from '../territories.mjs'

class RequestError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

const listFilters = new Set([
  'sport', 'competition', 'season', 'leagueCountry', 'country', 'kind',
  'organization', 'from', 'to', 'broadcastsOnly', 'offset', 'limit', 'generation'
])

function queryFor(url, allowed) {
  const values = Object.create(null)
  for (const [key, value] of url.searchParams) {
    if (!allowed.has(key) || key in values || !value) {
      throw new RequestError(400, 'invalid_query', `Unexpected, repeated or empty parameter: ${key}`)
    }
    values[key] = value
  }
  for (const key of ['sport', 'competition', 'season', 'organization', 'kind']) {
    if (values[key] && !isId(values[key])) throw new RequestError(400, 'invalid_query', `Invalid ${key}`)
  }
  for (const key of ['country', 'leagueCountry']) {
    if (values[key] && !isSupportedTerritory(values[key])) throw new RequestError(400, 'invalid_query', `Invalid ${key}`)
  }
  for (const key of ['from', 'to']) {
    if (values[key] && !isDate(values[key])) throw new RequestError(400, 'invalid_query', `Invalid ${key}`)
  }
  if (values.from && values.to && values.from > values.to) {
    throw new RequestError(400, 'invalid_query', 'from must be on or before to')
  }
  if (values.broadcastsOnly && (!['true', 'false'].includes(values.broadcastsOnly) || !values.country)) {
    throw new RequestError(400, 'invalid_query', 'broadcastsOnly requires country and a true or false value')
  }
  for (const [key, max] of [['offset', Number.MAX_SAFE_INTEGER], ['limit', 200]]) {
    const value = values[key]
    if (value != null && (!/^\d+$/.test(value) || Number(value) > max || (key === 'limit' && Number(value) < 1))) {
      throw new RequestError(400, 'invalid_query', `Invalid ${key}`)
    }
  }
  return values
}

function isCurrentBroadcast(season, row, now) {
  return isFresh(season, now) && isFresh(row, now) &&
    isFresh(season.markets.find(market => market.country === row.country), now)
}

function scopeFor(index, filters) {
  return [...index.seasons.values()].filter(season => {
    const competition = index.competitions.get(season.competitionId)
    return (!filters.season || filters.season === season.id) &&
      (!filters.competition || filters.competition === competition.id) &&
      (!filters.sport || filters.sport === competition.sport) &&
      (!filters.leagueCountry || filters.leagueCountry === competition.leagueCountry || competition.leagueCountries?.includes(filters.leagueCountry)) &&
      (!filters.kind || filters.kind === competition.kind)
  })
}

function coverageRow(index, season, country, now) {
  const competition = index.competitions.get(season.competitionId)
  const marketInfo = season.markets
    .filter(market => !country || market.country === country)
    .map(market => {
      const fresh = isFresh(market, now)
      return { country: market.country, status: fresh ? 'observed' : 'stale',
        listedFixtureCount: market.expectedListedFixtureIds.length, sourceUrl: market.sourceUrl,
        verifiedAt: market.verifiedAt, validUntil: market.validUntil,
        ...(fresh && market.rightsHolders ? { rightsHolders: market.rightsHolders } : {}) }
    })
  return {
    seasonId: season.id, competitionId: competition.id, sport: competition.sport,
    leagueCountry: competition.leagueCountry, ...(competition.leagueCountries && { leagueCountries: competition.leagueCountries }),
    label: season.label, startsOn: season.startsOn, endsOn: season.endsOn,
    fixtureCount: season.expectedFixtureIds.length, scheduleStatus: isFresh(season, now) ? 'current' : 'stale',
    fixtureInventoryStatus: season.fixtureInventoryStatus ??
      (season.expectedFixtureCount > season.expectedFixtureIds.length ? 'partial' : 'complete'),
    ...(season.expectedFixtureCount ? { expectedFixtureCount: season.expectedFixtureCount } : {}),
    sourceUrl: season.sourceUrl, verifiedAt: season.verifiedAt, validUntil: season.validUntil,
    markets: marketInfo,
    ...(country ? { country, marketStatus: marketInfo[0]?.status ?? 'not_covered' } : {})
  }
}

function competitionWithOrganizer(index, competition) {
  return { ...competition, organizer: index.organizations.get(competition.organizerId) }
}

function fixtureResponse(index, fixture, country, now, exactOnly) {
  const { seasonId, participants, broadcasts, ...fields } = fixture
  const season = index.seasons.get(seasonId)
  const market = season.markets.find(row => row.country === country)
  const relevant = broadcasts.filter(row => (!country || row.country === country) && (!exactOnly || row.type !== 'network'))
  const listings = relevant.filter(row => isCurrentBroadcast(season, row, now)).map(row => {
    const matching = [...index.offers.values()].filter(offer =>
      offer.country === row.country && offer.destinationIds.includes(row.destinationId) &&
      offer.competitionIds.includes(season.competitionId) && (!offer.fixtureIds || offer.fixtureIds.includes(fixture.id)))
    const offers = matching.filter(offer => isFresh(offer, now)).map(({
      id, country, provider, plan, currency, amountMinor, billingPeriod, terms, sourceUrl, entitlementSourceUrl, verifiedAt, validUntil
    }) => ({ id, country, provider, plan, currency, amountMinor, billingPeriod, terms, sourceUrl, entitlementSourceUrl, verifiedAt, validUntil }))
    return { ...row, airtimeStatus: row.airsAt === null ? 'not_published' : 'published',
      priceStatus: offers.length ? 'verified' : matching.length ? 'stale' : 'unverified', offers }
  })
  const noAiring = market?.noAiring?.find(row => row.fixtureId === fixture.id)
  let broadcastStatus = 'unverified'
  if (listings.length) broadcastStatus = 'listed'
  else if (country && !market) broadcastStatus = 'not_covered'
  else if ((market && !isFresh(market, now)) || relevant.length || (noAiring && !isFresh(noAiring, now))) {
    broadcastStatus = 'stale'
  } else if (noAiring && isFresh(season, now)) broadcastStatus = 'not_scheduled'
  return { ...fields, seasonId, competitionId: season.competitionId,
    competition: competitionWithOrganizer(index, index.competitions.get(season.competitionId)),
    scheduleStatus: isFresh(season, now) ? 'current' : 'stale',
    participants: participants.map(participant => ({ role: participant.role,
      organization: index.organizations.get(participant.organizationId) })),
    ...(country ? { country } : {}), broadcastStatus, broadcasts: listings,
    ...(broadcastStatus === 'not_scheduled' ? { noAiringEvidence: noAiring } : {}) }
}

function page(index, query, rows) {
  if (query.generation && query.generation !== index.generatedAt) {
    throw new RequestError(409, 'catalog_changed', 'The catalog changed. Restart pagination.')
  }
  const offset = Number(query.offset ?? 0)
  const limit = Number(query.limit ?? 100)
  return { generatedAt: index.generatedAt, total: rows.length, offset, limit,
    nextOffset: offset + limit < rows.length ? offset + limit : null,
    data: rows.slice(offset, offset + limit) }
}

function fixtures(index, url, now, exactOnly) {
  const query = queryFor(url, listFilters)
  const seasonIds = new Set(scopeFor(index, query).map(season => season.id))
  const rows = index.orderedFixtures.filter(row => seasonIds.has(row.seasonId) &&
    (!query.organization || row.participants.some(participant => participant.organizationId === query.organization)) &&
    (!query.from || row.date >= query.from) && (!query.to || row.date <= query.to) &&
    (query.broadcastsOnly !== 'true' || row.broadcasts.some(broadcast => broadcast.country === query.country &&
      (!exactOnly || broadcast.type !== 'network') && isCurrentBroadcast(index.seasons.get(row.seasonId), broadcast, now))))
  const result = page(index, query, rows)
  return { ...result, data: result.data.map(row => fixtureResponse(index, row, query.country, now, exactOnly)) }
}

const routeFilters = {
  '/v1/competitions': new Set(['sport', 'competition', 'season', 'leagueCountry', 'kind', 'offset', 'limit', 'generation']),
  '/v1/organizations': new Set(['kind', 'country', 'organization', 'offset', 'limit', 'generation']),
  '/v1/coverage': new Set(['sport', 'competition', 'season', 'leagueCountry', 'country', 'kind', 'offset', 'limit', 'generation'])
}

function route(index, url, now, exactOnly) {
  if (url.pathname === '/v1/fixtures') return fixtures(index, url, now, exactOnly)
  const fixtureId = /^\/v1\/fixtures\/([a-z0-9_-]+)$/.exec(url.pathname)?.[1]
  if (fixtureId) {
    const query = queryFor(url, new Set(['country']))
    const fixture = index.fixtures.get(fixtureId)
    if (!fixture) throw new RequestError(404, 'not_found', 'Fixture not found')
    return { generatedAt: index.generatedAt, data: fixtureResponse(index, fixture, query.country, now, exactOnly) }
  }
  const allowed = routeFilters[url.pathname]
  if (!allowed) throw new RequestError(404, 'not_found', 'Route not found')
  const query = queryFor(url, allowed)
  const seasons = scopeFor(index, query)
  if (url.pathname === '/v1/coverage') {
    return page(index, query, seasons.map(season => coverageRow(index, season, query.country, now)))
  }
  if (url.pathname === '/v1/competitions') {
    const ids = new Set(seasons.map(season => season.competitionId))
    const rows = [...index.competitions.values()].filter(row => ids.has(row.id))
      .map(row => ({ ...competitionWithOrganizer(index, row),
        seasonIds: seasons.filter(season => season.competitionId === row.id).map(season => season.id) }))
    return page(index, query, rows)
  }
  const rows = [...index.organizations.values()].filter(row =>
    (!query.organization || row.id === query.organization) &&
    (!query.kind || row.kind === query.kind) && (!query.country || row.country === query.country))
  return page(index, query, rows)
}

function equalSecret(supplied, expected) {
  if (typeof supplied !== 'string' || !expected) return false
  const left = Buffer.from(supplied)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function catalogHandler({ snapshot, clock = Date.now, proxySecret, token, exactOnly = false }) {
  return async (request, response) => {
    let status = 200
    let body
    try {
      if (request.method !== 'GET') throw new RequestError(405, 'method_not_allowed', 'Use GET')
      const url = new URL(request.url, 'http://localhost')
      if (url.pathname === '/livez') {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
        response.end(JSON.stringify({ status: 'alive' }))
        return
      }
      if ((proxySecret || token) && !equalSecret(request.headers['x-rapidapi-proxy-secret'], proxySecret) &&
          !equalSecret(request.headers.authorization, token ? `Bearer ${token}` : null)) {
        throw new RequestError(401, 'unauthorized', 'Authentication required')
      }
      if (url.pathname === '/healthz') {
        const index = await snapshot()
        const current = [...index.seasons.values()].some(season => isFresh(season, clock()))
        status = current ? 200 : 503
        body = { status: current ? 'ready' : 'stale', generatedAt: index.generatedAt }
      } else {
        body = route(await snapshot(), url, clock(), exactOnly)
      }
    } catch (error) {
      status = error instanceof RequestError ? error.status : 503
      body = { error: error instanceof RequestError ? error.code : 'catalog_unavailable',
        message: error instanceof RequestError ? error.message : 'A validated catalog is temporarily unavailable' }
    }
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      ...(status === 405 ? { Allow: 'GET' } : {}) })
    response.end(JSON.stringify(body))
  }
}
