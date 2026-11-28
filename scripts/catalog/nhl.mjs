import { isDate, isTimestamp } from './model.mjs'

const seasonId = 'nhl-2026-27'
const edition = 20262027
// A dated roster keeps this season refreshable after the next season starts.
export const nhlRoster = 'https://api-web.nhle.com/v1/standings/2026-11-27'
const logoUrl = 'https://assets.nhle.com/logos/nhl/svg/NHL_light.svg'
const canadianTeams = new Set(['CGY', 'EDM', 'MTL', 'OTT', 'TOR', 'VAN', 'WPG'])
const services = new Set(['ESPN+', 'HULU', 'Disney+', 'HBO MAX', 'Prime', 'SN+'])
const networks = new Set(['SN'])
const scheduleUrl = code => 'https://api-web.nhle.com/v1/club-schedule-season/' + code + '/' + edition

export async function loadNhlSeason(fetchJson, evidence) {
  const roster = (await fetchJson(nhlRoster)).standings
  if (roster?.length !== 32 || roster.some(row => row.seasonId !== edition)) throw new Error('Incomplete NHL season roster')
  const teams = new Map()
  for (const row of roster) {
    const code = row.teamAbbrev?.default
    if (!/^[A-Z]{3}$/.test(code) || teams.has(code) || !row.teamName?.default ||
        !row.teamLogo?.startsWith('https://assets.nhle.com/logos/nhl/')) throw new Error('Invalid NHL team record')
    teams.set(code, { id: 'nhl-' + code.toLowerCase(), kind: 'club', name: row.teamName.default,
      country: canadianTeams.has(code) ? 'CA' : 'US', logo: { url: row.teamLogo, sourceUrl: nhlRoster } })
  }
  const games = new Map()
  const codes = [...teams.keys()].sort()
  for (let i = 0; i < codes.length; i += 4) {
    const group = codes.slice(i, i + 4)
    const schedules = await Promise.all(group.map(code => fetchJson(scheduleUrl(code))))
    for (const [index, schedule] of schedules.entries()) {
      const code = group[index]
      const regular = schedule.games.filter(game => game.gameType === 2 && game.season === edition)
      if (regular.length !== 84 || new Set(regular.map(game => game.id)).size !== 84) throw new Error('Incomplete NHL schedule for ' + code)
      for (const game of regular) {
        const home = game.homeTeam?.abbrev
        const away = game.awayTeam?.abbrev
        if (!teams.has(home) || !teams.has(away) || home === away || ![home, away].includes(code) ||
            !/^202602\d{4}$/.test(String(game.id)) || !isDate(game.gameDate)) throw new Error('Invalid NHL game ' + game.id)
        const pair = games.get(game.id) ?? new Map()
        pair.set(code, game)
        games.set(game.id, pair)
      }
    }
  }
  if (games.size !== 1344) throw new Error('Incomplete NHL regular season')
  const fixtures = []
  for (const [id, copies] of games) {
    const first = copies.values().next().value
    const home = teams.get(first.homeTeam.abbrev)
    const away = teams.get(first.awayTeam.abbrev)
    const homeGame = copies.get(first.homeTeam.abbrev)
    const awayGame = copies.get(first.awayTeam.abbrev)
    if (copies.size !== 2 || !homeGame || !awayGame || homeGame.homeTeam.abbrev !== awayGame.homeTeam.abbrev ||
        homeGame.awayTeam.abbrev !== awayGame.awayTeam.abbrev || homeGame.gameDate !== awayGame.gameDate) {
      throw new Error('Conflicting NHL fixture identity ' + id)
    }
    const sourcesAgree = homeGame.gameScheduleState === awayGame.gameScheduleState && homeGame.startTimeUTC === awayGame.startTimeUTC
    const postponed = [homeGame, awayGame].some(g => g.gameScheduleState === 'PPD' || g.gameState === 'PPD')
    const confirmed = sourcesAgree && !postponed && homeGame.gameScheduleState === 'OK' && isTimestamp(homeGame.startTimeUTC)
    const broadcasts = new Map()
    for (const [code, game] of copies) {
      for (const b of game.tvBroadcasts ?? []) {
        if (postponed || b.market !== 'N' || !['US','CA'].includes(b.countryCode) || !b.network || !Number.isInteger(b.id)) continue
        const destinationId = 'nhl-' + b.countryCode.toLowerCase() + '-' + b.id
        broadcasts.set(destinationId, { ...evidence, sourceUrl: scheduleUrl(code), country: b.countryCode,
          destinationId, name: b.network, type: services.has(b.network) ? 'service' : networks.has(b.network) ? 'network' : 'channel',
          kind: 'unspecified', airsAt: null })
      }
    }
    fixtures.push({ id: 'nhl-' + id, seasonId, date: homeGame.gameDate, title: away.name + ' at ' + home.name,
      sourceUrl: scheduleUrl(homeGame.homeTeam.abbrev), startsAt: confirmed ? homeGame.startTimeUTC : null,
      startStatus: postponed ? 'postponed' : confirmed ? 'scheduled' : 'unannounced',
      ...(!homeGame.neutralSite ? { venueCountry: home.country } : {}),
      participants: [{ organizationId: home.id, role: 'home' }, { organizationId: away.id, role: 'away' }],
      broadcasts: [...broadcasts.values()] })
  }
  fixtures.sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  const logo = { url: logoUrl, sourceUrl: logoUrl }
  const organizer = { id: 'nhl-organization', kind: 'organizer', name: 'National Hockey League', country: null, logo }
  const sourceUrl = 'https://www.nhl.com/schedule'
  return { competitions: [{ id: 'nhl', name: 'National Hockey League', sport: 'ice-hockey', kind: 'league',
    leagueCountry: null, leagueCountries: ['CA', 'US'], organizerId: organizer.id, logo }],
    organizations: [organizer, ...teams.values()], fixtures, seasons: [{ ...evidence, id: seasonId, competitionId: 'nhl',
      label: '2026/27 regular season', startsOn: fixtures[0].date, endsOn: fixtures.at(-1).date, sourceUrl,
      expectedFixtureCount: 1344, expectedFixtureIds: fixtures.map(row => row.id),
      markets: ['CA', 'US'].map(country => ({ ...evidence, country, sourceUrl,
        expectedListedFixtureIds: fixtures.filter(row => row.broadcasts.some(b => b.country === country)).map(row => row.id) })) }] }
}

export const nhlPrimePricing = 'https://www.aboutamazon.ca/news/retail/heres-how-much-a-prime-membership-costs-and-how-to-make-the-most-of-its-benefits'
export const nhlPrimeRights = 'https://www.aboutamazon.ca/news/entertainment/nhl-on-prime-unveils-2026-27-wednesday-night-hockey-schedule'

export function nhlPrimeOffers(fixtures, pricing, rights, evidence) {
  const plain = html => html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|\s+/g, ' ').replace(/ +/g, ' ')
  const terms = plain(rights)
  const prices = plain(pricing).match(/A Prime membership is \$(\d+(?:\.\d{2})?) per month, or \$(\d+(?:\.\d{2})?) per year if you pay annually, plus applicable taxes/i)
  if (!prices || !/2026[-–](?:20)?27 NHL on Prime schedule/i.test(terms) ||
      !/at no additional cost to Prime members in Canada/i.test(terms)) return []
  const destinations = new Set()
  const fixtureIds = fixtures.filter(row => row.broadcasts.some(b => {
    if (b.country !== 'CA' || b.name !== 'Prime' || b.type !== 'service') return false
    destinations.add(b.destinationId)
    return true
  })).map(row => row.id)
  if (!fixtureIds.length) return []
  return ['month', 'year'].map((billingPeriod, i) => ({
    ...evidence, id: 'ca-prime-nhl-' + billingPeriod, provider: 'Amazon', plan: 'Prime', country: 'CA',
    billingPeriod, currency: 'CAD', amountMinor: Math.round(Number(prices[i + 1]) * 100),
    competitionIds: ['nhl'], destinationIds: [...destinations], fixtureIds,
    sourceUrl: nhlPrimePricing, entitlementSourceUrl: nhlPrimeRights, terms: 'Standard Canadian Prime membership, plus applicable taxes.'
  }))
}
