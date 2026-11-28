import sportCountries from '../../config/sport-countries.json' with { type: 'json' }
import rightsInventory from '../../config/official-event-broadcasters.json' with { type: 'json' }
import { SUPPORTED_TERRITORIES } from '../territories.mjs'
import { isFresh } from './model.mjs'
import { verifyLogoAssets } from './logo-assets.mjs'

/**
 * Audit the entire snapshot served by the API. Observed, rights-only and
 * provisional records are useful for previews but cannot pass a release.
 */
export function auditRelease(index, { now = Date.now(), worldwide = false, logoResults, includeDetails = false } = {}) {
  const issues = Object.create(null)
  const counts = {
    seasons: index.seasons.size, fixtures: index.fixtures.size, competitionLogos: 0, organizationLogos: 0,
    uniqueLogoAssets: 0, markets: 0, fixtureMarketPairs: 0, exactAirings: 0, pricedAirings: 0,
    explicitlyUnaired: 0
  }
  let validUntil = Infinity
  function addIssue(type, id) {
    const group = issues[type] ??= { count: 0, examples: [] }
    group.count++
    if (group.examples.length < 5) group.examples.push(id)
    if (includeDetails) (group.ids ??= []).push(id)
  }
  function current(row, type, context) {
    if (!isFresh(row, now)) {
      addIssue(type, context)
      return false
    }
    validUntil = Math.min(validUntil, Date.parse(row.validUntil))
    return true
  }

  const assets = new Set()
  for (const [kind, rows] of [['competition', index.competitions], ['organization', index.organizations]]) {
    for (const { id, logo } of rows.values()) {
      if (!logo) {
        addIssue(`missing_${kind}_logo`, id)
        continue
      }
      counts[`${kind}Logos`]++
      assets.add(logo.url)
    }
  }
  counts.uniqueLogoAssets = assets.size
  if (logoResults) {
    for (const url of assets) {
      if (logoResults.get(url) !== true) addIssue('invalid_logo_asset', url)
    }
  } else if (assets.size) {
    addIssue('logo_assets_unchecked', String(assets.size))
  }

  if (worldwide) {
    const editionCompetitions = new Set([...index.seasons.values()].map(row => row.competitionId))
    const sports = new Set([...editionCompetitions].map(id => index.competitions.get(id).sport))
    for (const sport of ['football', ...Object.keys(sportCountries)]) {
      if (!sports.has(sport)) addIssue('missing_sport', sport)
    }
    const today = new Date(now).toISOString().slice(0, 10)
    for (const competition of rightsInventory.competitions) {
      if (competition.cycles.some(cycle => cycle.validFrom <= today && today <= cycle.validThrough) &&
          !editionCompetitions.has(competition.id)) addIssue('missing_competition', competition.id)
    }
    for (const country of [null, ...SUPPORTED_TERRITORIES]) {
      const label = country ?? 'international'
      const inventory = index.competitionInventory.get(country)
      if (!inventory) {
        addIssue('missing_competition_inventory', label)
        continue
      }
      current(inventory, 'stale_competition_inventory', label)
      for (const id of inventory.seasonIds) {
        if (!index.seasons.has(id)) addIssue('missing_competition_season', `${label}/${id}`)
      }
    }
    for (const season of index.seasons.values()) {
      const competition = index.competitions.get(season.competitionId)
      for (const country of competition.leagueCountries ?? [competition.leagueCountry]) {
        const inventory = index.competitionInventory.get(country)
        if (inventory && !inventory.seasonIds.includes(season.id)) {
          addIssue('season_outside_competition_inventory', `${country ?? 'international'}/${season.id}`)
        }
      }
    }
  }

  const offers = new Map()
  for (const offer of index.offers.values()) {
    for (const competition of offer.competitionIds) {
      for (const destination of offer.destinationIds) {
        const key = [competition, offer.country, destination].join('/')
        const matching = offers.get(key) ?? []
        matching.push(offer)
        offers.set(key, matching)
      }
    }
  }
  for (const season of index.seasons.values()) {
    current(season, 'stale_season', season.id)
    const competition = index.competitions.get(season.competitionId)
    const fixtures = season.expectedFixtureIds.map(id => index.fixtures.get(id))
    if (['unannounced', 'partial'].includes(season.fixtureInventoryStatus) || season.expectedFixtureCount > fixtures.length) {
      addIssue('incomplete_fixture_inventory', season.id)
    }
    const markets = new Set(season.markets.map(market => market.country))
    if (markets.size === 0) addIssue('no_broadcast_market', season.id)
    if (worldwide) {
      for (const country of SUPPORTED_TERRITORIES) {
        if (!markets.has(country)) addIssue('missing_market', `${season.id}/${country}`)
      }
    }
    for (const fixture of fixtures) {
      if (!['scheduled', 'cancelled'].includes(fixture.startStatus)) addIssue('unconfirmed_start', fixture.id)
      if (['football', 'basketball', 'rugby', 'cricket', 'ice-hockey', 'baseball', 'american-football'].includes(competition.sport) && (fixture.participants.length !== 2 ||
          !['home', 'away'].every(role => fixture.participants.some(row => row.role === role)))) {
        addIssue('missing_fixture_participant', fixture.id)
      }
    }
    for (const market of season.markets) {
      counts.markets++
      const scope = `${season.id}/${market.country}`
      current(market, 'stale_market', scope)
      const noAiring = new Map((market.noAiring ?? []).map(row => [row.fixtureId, row]))
      for (const fixture of fixtures) {
        if (fixture.startStatus === 'cancelled') continue
        counts.fixtureMarketPairs++
        const context = `${fixture.id}/${market.country}`
        const proof = noAiring.get(fixture.id)
        if (proof) {
          if (current(proof, 'stale_no_airing_evidence', context)) counts.explicitlyUnaired++
          continue
        }
        const airings = fixture.broadcasts.filter(row => row.country === market.country && row.type !== 'network')
        if (airings.length === 0) addIssue('missing_exact_airing', context)
        else if (!airings.some(row => row.kind === 'live')) addIssue('missing_live_airing', context)
        for (const airing of airings) {
          counts.exactAirings++
          const destination = `${context}/${airing.destinationId}`
          current(airing, 'stale_airing', destination)
          if (!airing.airsAt) addIssue('missing_airtime', destination)
          if (airing.kind === 'unspecified') addIssue('unknown_airing_kind', destination)
          const matching = offers.get([competition.id, market.country, airing.destinationId].join('/')) ?? []
          const prices = matching.filter(row => isFresh(row, now) && (!row.fixtureIds || row.fixtureIds.includes(fixture.id)))
          if (prices.length === 0) addIssue('missing_current_price', destination)
          else {
            counts.pricedAirings++
            // All currently displayed plans remain current during this release.
            for (const offer of prices) validUntil = Math.min(validUntil, Date.parse(offer.validUntil))
          }
        }
      }
    }
  }
  return {
    ready: Object.keys(issues).length === 0, checkedAt: new Date(now).toISOString(), worldwide, counts, issues,
    validUntil: Number.isFinite(validUntil) ? new Date(validUntil).toISOString() : null
  }
}

export function summarizeIssues(issues) {
  return Object.entries(issues).map(([type, { count }]) => `${type}=${count}`).join(', ')
}

export async function verifyRelease(index, { worldwide = false, includeDetails = false } = {}) {
  const logoResults = await verifyLogoAssets(index)
  return auditRelease(index, { worldwide, logoResults, includeDetails })
}
