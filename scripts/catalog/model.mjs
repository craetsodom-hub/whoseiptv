import { isSupportedTerritory } from '../territories.mjs'

const idPattern = /^[a-z0-9][a-z0-9_-]{0,119}$/
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const currencies = new Set(Intl.supportedValuesOf('currency'))

export function isDate(value) {
  return typeof value === 'string' && datePattern.test(value) && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
}

export function isFresh(row, now) {
  return Date.parse(row?.verifiedAt) <= now && now < Date.parse(row?.validUntil)
}

export function isId(value) {
  return typeof value === 'string' && idPattern.test(value)
}

export function isTimestamp(value) {
  return typeof value === 'string' && timestampPattern.test(value) && isDate(value.slice(0, 10)) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === (value.includes('.') ? value : value.replace('Z', '.000Z'))
}

function isUrl(value) {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 300
}

function requireThat(condition, message) {
  if (!condition) throw new Error(message)
}

function byId(rows, label) {
  requireThat(Array.isArray(rows), `Missing ${label} array`)
  const result = new Map()
  for (const row of rows) {
    requireThat(isId(row?.id) && !result.has(row.id), `Invalid or duplicate ${label} ID: ${row?.id}`)
    result.set(row.id, row)
  }
  return result
}

function validateEvidence(row, generatedAt, label) {
  requireThat(isUrl(row.sourceUrl) && isTimestamp(row.verifiedAt) && isTimestamp(row.validUntil) &&
    Date.parse(row.verifiedAt) <= Date.parse(generatedAt) && Date.parse(row.verifiedAt) < Date.parse(row.validUntil),
  `Invalid ${label} evidence`)
}

function validateLogo(logo, label) {
  if (logo == null) return
  requireThat(isUrl(logo.url) && isUrl(logo.sourceUrl), `Invalid ${label} logo`)
}

function checkInventory(expected, actual, label) {
  requireThat(Array.isArray(expected) && expected.every(isId), `Missing ${label} inventory`)
  const ids = new Set(expected)
  requireThat(ids.size === expected.length && ids.size === actual.size && [...actual].every(id => ids.has(id)),
    `Incomplete or inconsistent ${label} inventory`)
}

function validateFixture(fixture, season, organizations, generatedAt, marketListings) {
  const { id, participants, broadcasts, startStatus, startsAt } = fixture
  requireThat(season && isText(fixture.title) && isDate(fixture.date) &&
    fixture.date >= season.startsOn && fixture.date <= season.endsOn &&
    isUrl(fixture.sourceUrl), `Invalid fixture ${id}`)
  requireThat((['scheduled', 'provisional'].includes(startStatus) && isTimestamp(startsAt)) ||
    (['unannounced', 'postponed', 'cancelled'].includes(startStatus) && startsAt === null),
  `Invalid start time for fixture ${id}`)
  if (fixture.venueCountry != null) requireThat(isSupportedTerritory(fixture.venueCountry), `Invalid venue country on ${id}`)
  requireThat(Array.isArray(participants) && Array.isArray(broadcasts), `Invalid fixture details on ${id}`)
  const participantIds = new Set()
  for (const { organizationId, role } of participants) {
    requireThat(organizations.has(organizationId) && !participantIds.has(organizationId) &&
      ['home', 'away', 'participant'].includes(role), `Invalid participant on ${id}`)
    participantIds.add(organizationId)
  }
  const destinations = new Set()
  for (const broadcast of broadcasts) {
    const key = JSON.stringify([broadcast.country, broadcast.destinationId, broadcast.kind, broadcast.airsAt])
    requireThat(isSupportedTerritory(broadcast.country) && isId(broadcast.destinationId) &&
      isText(broadcast.name) && ['channel', 'service', 'network'].includes(broadcast.type) &&
      ['live', 'replay', 'delayed', 'unspecified'].includes(broadcast.kind) &&
      (broadcast.airsAt === null || isTimestamp(broadcast.airsAt)) && !destinations.has(key),
    `Invalid or duplicate broadcast on ${id}`)
    destinations.add(key)
    validateEvidence(broadcast, generatedAt, `broadcast on ${id}`)
    const market = marketListings.get(broadcast.country) ?? new Set()
    market.add(id)
    marketListings.set(broadcast.country, market)
  }
}

export function indexCatalog(catalog) {
  requireThat(catalog?.schemaVersion === 1 && isTimestamp(catalog.generatedAt), 'Invalid catalog header')
  const { generatedAt } = catalog
  const organizations = byId(catalog.organizations, 'organization')
  const competitions = byId(catalog.competitions, 'competition')
  const seasons = byId(catalog.seasons, 'season')
  const fixtures = byId(catalog.fixtures, 'fixture')
  const offers = byId(catalog.offers, 'offer')
  requireThat(seasons.size && fixtures.size, 'The catalog must contain a season and fixtures')

  const competitionInventory = new Map()
  const inventories = catalog.competitionInventory ?? []
  requireThat(Array.isArray(inventories), 'Invalid competition inventory')
  for (const row of inventories) {
    const country = row?.country
    requireThat((country === null || isSupportedTerritory(country)) && !competitionInventory.has(country) &&
      Array.isArray(row.seasonIds) && row.seasonIds.every(isId) &&
      new Set(row.seasonIds).size === row.seasonIds.length,
    `Invalid competition inventory for ${country ?? 'international competitions'}`)
    validateEvidence(row, generatedAt, `competition inventory for ${country ?? 'international competitions'}`)
    competitionInventory.set(country, row)
  }

  for (const row of organizations.values()) {
    requireThat(isText(row.name) && ['club', 'team', 'federation', 'organizer', 'institution'].includes(row.kind) &&
      (row.country === null || isSupportedTerritory(row.country)), `Invalid organization ${row.id}`)
    validateLogo(row.logo, row.id)
  }
  for (const row of competitions.values()) {
    requireThat(isText(row.name) && isId(row.sport) &&
      ['league', 'cup', 'series', 'tournament'].includes(row.kind) &&
      (row.leagueCountry === null || isSupportedTerritory(row.leagueCountry)) &&
      organizations.has(row.organizerId), `Invalid competition ${row.id}`)
    if (row.leagueCountries !== undefined) {
      requireThat(Array.isArray(row.leagueCountries) && row.leagueCountries.length > 0 &&
        row.leagueCountries.every(isSupportedTerritory) && new Set(row.leagueCountries).size === row.leagueCountries.length &&
        (!row.leagueCountry || row.leagueCountries.includes(row.leagueCountry)), 'Invalid league countries for ' + row.id)
    }
    validateLogo(row.logo, row.id)
  }

  const seasonFixtures = new Map([...seasons.keys()].map(id => [id, { ids: new Set(), markets: new Map() }]))
  for (const fixture of fixtures.values()) {
    const group = seasonFixtures.get(fixture.seasonId)
    requireThat(group, `Unknown season on fixture ${fixture.id}`)
    validateFixture(fixture, seasons.get(fixture.seasonId), organizations, generatedAt, group.markets)
    group.ids.add(fixture.id)
  }
  for (const season of seasons.values()) {
    const { ids, markets } = seasonFixtures.get(season.id)
    const inventoryUnannounced = season.fixtureInventoryStatus === 'unannounced'
    requireThat(competitions.has(season.competitionId) && isText(season.label) &&
      isDate(season.startsOn) && isDate(season.endsOn) && season.startsOn <= season.endsOn &&
      (inventoryUnannounced ? ids.size === 0 : ids.size > 0 && [undefined, 'partial'].includes(season.fixtureInventoryStatus)) &&
      (season.expectedFixtureCount === undefined || (Number.isSafeInteger(season.expectedFixtureCount) &&
        season.expectedFixtureCount > 0 && ids.size <= season.expectedFixtureCount)) &&
      Array.isArray(season.markets), 'Invalid season ' + season.id)
    validateEvidence(season, generatedAt, `season ${season.id}`)
    checkInventory(season.expectedFixtureIds, ids, `fixture for ${season.id}`)
    const declared = new Set()
    for (const market of season.markets) {
      requireThat(isSupportedTerritory(market.country) && !declared.has(market.country), `Invalid market on ${season.id}`)
      validateEvidence(market, generatedAt, `market ${market.country}`)
      checkInventory(market.expectedListedFixtureIds, markets.get(market.country) ?? new Set(),
        `listed fixture for ${season.id}/${market.country}`)
      if (market.noAiring !== undefined) {
        requireThat(Array.isArray(market.noAiring), `Invalid no-airing inventory on ${season.id}/${market.country}`)
        const noAiringIds = new Set()
        for (const proof of market.noAiring) {
          requireThat(ids.has(proof?.fixtureId) && !noAiringIds.has(proof.fixtureId) &&
            !markets.get(market.country)?.has(proof.fixtureId),
          `Conflicting no-airing evidence on ${season.id}/${market.country}/${proof.fixtureId}`)
          validateEvidence(proof, generatedAt, `no-airing on ${proof.fixtureId}`)
          noAiringIds.add(proof.fixtureId)
        }
      }
      declared.add(market.country)
    }
    requireThat([...markets.keys()].every(country => declared.has(country)), `Undeclared broadcast market on ${season.id}`)
  }
  for (const offer of offers.values()) {
    validateEvidence(offer, generatedAt, `price for ${offer.id}`)
    requireThat(isSupportedTerritory(offer.country) && isText(offer.provider) && isText(offer.plan) &&
      currencies.has(offer.currency) && Number.isSafeInteger(offer.amountMinor) && offer.amountMinor >= 0 &&
      ['day', 'month', 'year', 'one-time', 'free'].includes(offer.billingPeriod) &&
      (offer.billingPeriod === 'free' ? offer.amountMinor === 0 : offer.amountMinor > 0) &&
      Array.isArray(offer.destinationIds) && offer.destinationIds.length && offer.destinationIds.every(isId) &&
      Array.isArray(offer.competitionIds) && offer.competitionIds.length &&
      offer.competitionIds.every(id => competitions.has(id)) &&
      (!offer.terms || isText(offer.terms)) &&
      (offer.entitlementSourceUrl === undefined || isUrl(offer.entitlementSourceUrl)), `Invalid offer ${offer.id}`)
    if (offer.fixtureIds !== undefined) {
      requireThat(Array.isArray(offer.fixtureIds) && offer.fixtureIds.length > 0 &&
        new Set(offer.fixtureIds).size === offer.fixtureIds.length && offer.fixtureIds.every(id => {
          const fixture = fixtures.get(id)
          return fixture && offer.competitionIds.includes(seasons.get(fixture.seasonId).competitionId) &&
            fixture.broadcasts.some(airing => airing.country === offer.country &&
              offer.destinationIds.includes(airing.destinationId))
        }), `Invalid fixture scope for offer ${offer.id}`)
    }
  }

  const orderedFixtures = [...fixtures.values()].sort((a, b) =>
    a.date.localeCompare(b.date) || (a.startsAt ?? '').localeCompare(b.startsAt ?? '') || a.id.localeCompare(b.id))
  return { generatedAt, organizations, competitions, seasons, fixtures, offers, orderedFixtures, competitionInventory }
}
