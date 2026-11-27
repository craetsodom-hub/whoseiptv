import { normalizeBroadcastText } from '../broadcast/normalize.mjs'
import { extractFormulaOneRaceLinks, parseFormulaOneBroadcasters } from '../official-f1.mjs'
import { parseSkyFixtureSchedule, skyLocalKickoff } from '../broadcast/sky-fixtures.mjs'

export const premierLeague = {
  fixtures: 'https://www.premierleague.com/en/news/4675097/all-380-fixtures-for-the-202627-premier-league-season',
  roster: 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams?limit=40',
  scoreboard: 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard'
}
export const formulaOne = {
  calendar: 'https://www.formula1.com/en/racing/2026',
  broadcasters: 'https://www.formula1.com/en/information/f1-broadcasters.1eqG3L8AlJATj7icjBtrfN'
}
export const sportsPricingUrl = 'https://www.nowtv.com/plans/new/sports'
export const sportsEntitlementsUrl = 'https://www.nowtv.com/gb/help/article/sports-memberships'

const MONTHS = 'january february march april may june july august september october november december'.split(' ')
const NAME_ALIASES = {
  bournemouth: 'afc bournemouth', brighton: 'brighton hove albion', coventry: 'coventry city',
  hull: 'hull city', ipswich: 'ipswich town', leeds: 'leeds united', 'man city': 'manchester city',
  'man utd': 'manchester united', newcastle: 'newcastle united', 'nott m forest': 'nottingham forest',
  nottingham: 'nottingham forest', spurs: 'tottenham hotspur', tottenham: 'tottenham hotspur'
}

function text(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&(?:amp|#38);/gi, '&')
    .replace(/&(?:apos|#39|rsquo);/gi, "'").replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/\s+/g, ' ').trim()
}

function teamKey(name) {
  return normalizeBroadcastText(name).replace(/\band\b/g, '').replace(/\s+/g, ' ').trim()
}

function slug(value) {
  return normalizeBroadcastText(value).replace(/ +/g, '-')
}

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`
}

function londonTime(date, time) {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const instant = skyLocalKickoff(year, month - 1, day, hour, minute)
  if (instant === null) throw new Error(`Invalid local kickoff ${date} ${time}`)
  return new Date(instant * 1000).toISOString()
}

function readPremierLeagueRoster(payload) {
  const league = payload.sports?.flatMap(sport => sport.leagues ?? []).find(row => row.slug === 'eng.1')
  if (!league || league.teams?.length !== 20) throw new Error('The competition roster must contain 20 clubs')
  return league.teams.map(({ team }) => {
    const id = slug(team.displayName)
    const logo = team.logos?.find(asset => asset.rel?.includes('default'))?.href
    if (!/^\d+$/.test(String(team.id)) || !/^https:\/\/a\.espncdn\.com\/i\/teamlogos\//.test(logo ?? '')) {
      throw new Error(`Missing club ID or logo for ${team.displayName}`)
    }
    return { id: `club-${id}`, name: team.displayName, kind: 'club', country: 'GB',
      logo: { url: logo, sourceUrl: premierLeague.roster } }
  })
}

export function premierLeagueConflicts(fixtures) {
  const byId = new Map()
  for (const fixture of fixtures) {
    const group = byId.get(fixture.id) ?? []
    group.push(fixture)
    byId.set(fixture.id, group)
  }
  return [...byId.values()].filter(rows => rows.length > 1)
}

export function resolvePremierLeagueConflict(rows, scoreboards) {
  const winner = rows.filter(fixture => {
    const month = fixture.date.slice(0, 7).replace('-', '')
    return scoreboards.get(month)?.events?.some(event => {
      const teams = event.competitions?.[0]?.competitors ?? []
      return Date.parse(event.date) === Date.parse(fixture.startsAt) &&
        ['home', 'away'].every(role => {
          const team = teams.find(entry => entry.homeAway === role)?.team
          return team?.displayName &&
            fixture.participants.find(entry => entry.role === role)?.organizationId === `club-${slug(team.displayName)}`
        })
    })
  })
  if (winner.length !== 1) throw new Error(`Conflicting published kickoff for ${rows[0].id}`)
  const [fixture] = winner
  const month = fixture.date.slice(0, 7).replace('-', '')
  return { ...fixture, scheduleCrossCheckUrl: `${premierLeague.scoreboard}?dates=${month}&limit=300` }
}

export function parsePremierLeague(html, roster, evidence) {
  const organization = { id: 'premier-league', name: 'Premier League', kind: 'organizer', country: 'GB' }
  const competition = { id: 'premier-league', name: 'Premier League', sport: 'football', kind: 'league',
    leagueCountry: 'GB', organizerId: organization.id }
  const seasonId = 'premier-league-2026-27'
  const clubs = readPremierLeagueRoster(roster)
  const clubsByName = new Map(clubs.map(club => [teamKey(club.name), club]))
  const lookup = name => {
    const key = teamKey(name)
    const club = clubsByName.get(NAME_ALIASES[key] ?? key)
    if (!club) throw new Error(`Unknown club: ${name}`)
    return club
  }
  const fixtureId = (home, away) => `pl-2026-27-${home.id.slice(5)}-v-${away.id.slice(5)}`
  const expectedFixtureIds = clubs.flatMap(home => clubs.filter(away => away !== home).map(away => fixtureId(home, away)))
  const fixtures = []
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? html
  const fixtureBlocks = [...article.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
  for (const [, block] of fixtureBlocks) {
    const lines = block.replace(/<br\s*\/?\s*>/gi, '\n').split('\n').map(text).filter(Boolean)
    const heading = lines.shift()?.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) (\d{1,2}) ([a-z]+)(?: (20\d{2}))?$/i)
    if (!heading) continue
    const [, weekday, day, monthName, year] = heading
    const month = MONTHS.indexOf(monthName.toLowerCase()) + 1
    if (!month) throw new Error(`Unrecognized fixture month ${monthName}`)
    const date = isoDate(year ?? (month >= 8 ? '2026' : '2027'), month, day)
    const defaultTime = /^(Saturday|Sunday)$/i.test(weekday) ? '15:00' : null
    for (const line of lines) {
      const match = line.match(/^(?:(\d{2}:\d{2}) (?:GMT |BST )?)?(.+?) v ([^(]+?)(?:\s*\(([^)]+)\))?\**$/)
      if (!match) {
        if (/\bv\b/.test(line)) throw new Error(`Unrecognized fixture line: ${line}`)
        continue
      }
      const [, kickoff, homeName, awayName, network] = match
      const home = lookup(homeName)
      const away = lookup(awayName)
      const time = kickoff ?? defaultTime
      fixtures.push({
        id: fixtureId(home, away), seasonId, title: `${home.name} v ${away.name}`, date,
        startsAt: time ? londonTime(date, time) : null,
        startStatus: kickoff ? 'scheduled' : time ? 'provisional' : 'unannounced',
        sourceUrl: premierLeague.fixtures,
        participants: [{ organizationId: home.id, role: 'home' }, { organizationId: away.id, role: 'away' }],
        broadcasts: network ? [{
          country: 'GB', destinationId: slug(network), name: network, type: 'network', kind: 'live',
          airsAt: null, sourceUrl: premierLeague.fixtures, ...evidence
        }] : []
      })
    }
  }
  const season = {
    id: seasonId, competitionId: competition.id, label: '2026/27', startsOn: '2026-08-01', endsOn: '2027-05-31',
    sourceUrl: premierLeague.fixtures, ...evidence, expectedFixtureIds,
    markets: [{ country: 'GB', sourceUrl: premierLeague.fixtures, ...evidence,
      expectedListedFixtureIds: fixtures.filter(fixture => fixture.broadcasts.length).map(fixture => fixture.id) }]
  }
  return { organizations: [organization, ...clubs], competitions: [competition], seasons: [season], fixtures }
}

export function addPremierLeagueTelevision(batch, html, evidence) {
  const candidatesByFixture = new Map()
  const clubIds = new Map(batch.organizations.filter(row => row.kind === 'club')
    .map(row => [teamKey(row.name), row.id]))
  const fixtureByMatchup = new Map(batch.fixtures.map(fixture => [
    fixture.participants.map(row => row.organizationId).join('|'), fixture
  ]))
  for (const candidate of parseSkyFixtureSchedule(html, {}, new Date(evidence.verifiedAt), { includeAirtimes: true })) {
    const key = [candidate.homeTeam, candidate.awayTeam].map(team => {
      const normalized = teamKey(team)
      return clubIds.get(NAME_ALIASES[normalized] ?? normalized)
    }).join('|')
    const fixture = fixtureByMatchup.get(key)
    if (!fixture || Date.parse(fixture.startsAt) !== candidate.startUtcEpochSeconds * 1000) continue
    const broadcasts = candidatesByFixture.get(fixture.id) ?? new Map()
    for (const broadcast of candidate.broadcasts) {
      if (broadcast.channelName === 'Sky Sports') continue
      const destinationId = slug(broadcast.channelName)
      const time = broadcast.airsAtUtcEpochSeconds
      const airsAt = time ? new Date(time * 1000).toISOString() : null
      const previous = broadcasts.get(destinationId)
      if (previous && previous.airsAt !== airsAt) {
        previous.airsAt = null
        continue
      }
      broadcasts.set(destinationId, { ...evidence, country: 'GB', destinationId, name: broadcast.channelName,
        type: 'channel', kind: 'live', airsAt, sourceUrl: broadcast.sourceUrl })
    }
    candidatesByFixture.set(fixture.id, broadcasts)
  }
  for (const fixture of batch.fixtures) {
    const channels = candidatesByFixture.get(fixture.id)
    if (channels?.size) fixture.broadcasts.push(...channels.values())
  }
}

function embeddedJson(html, attributePattern) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attributes]) => attributePattern.test(attributes))
    .map(([, , body]) => JSON.parse(body))
}

export function formulaOneRaceUrls(html) {
  return extractFormulaOneRaceLinks(html, 2026).filter(url => !url.includes('/pre-season-testing'))
}

export function parseFormulaOneSeason(calendarHtml, racePages, broadcastersHtml, evidence) {
  const organization = { id: 'formula-one', name: 'Formula 1', kind: 'organizer', country: null }
  const competition = { id: 'formula-1', name: 'Formula 1', kind: 'series', sport: 'formula1',
    leagueCountry: null, organizerId: organization.id }
  const seasonId = 'formula-1-2026'
  const icon = [...calendarHtml.matchAll(/<link\b[^>]+>/gi)]
    .find(([tag]) => /\brel=["']icon["']/i.test(tag) && /\btype=["']image\/svg\+xml["']/i.test(tag))
    ?.[0].match(/\bhref=["'](\/assets\/racing\/_next\/static\/media\/f1-logo\.[a-f0-9]+\.svg)["']/i)?.[1]
  if (icon) {
    competition.logo = { url: new URL(icon, formulaOne.calendar).href, sourceUrl: formulaOne.calendar }
    organization.logo = competition.logo
  }
  const urls = formulaOneRaceUrls(calendarHtml)
  if (urls.length !== 23) throw new Error(`Expected 23 non-testing calendar entries, received ${urls.length}`)
  const fixtures = urls.flatMap(url => {
    const root = embeddedJson(racePages.get(url) ?? '', /type=["']application\/ld\+json["']/i)
      .find(row => row['@type'] === 'SportsEvent' && row['@id'] === url)
    if (!root || !Array.isArray(root.subEvent) || !root.subEvent.some(row => /^Race\s*-/.test(row.name))) {
      throw new Error(`Incomplete session schedule for ${url}`)
    }
    return root.subEvent.map(session => {
      if (!String(session['@id']).startsWith(`${url}#`) || !/Z$/.test(session.startDate ?? '')) {
        throw new Error(`Incomplete session identity or time for ${url}`)
      }
      const id = `f1-2026-${url.split('/').at(-1)}-${slug(session['@id'].split('#').at(-1))}`
      return { id, seasonId, title: session.name, date: session.startDate.slice(0, 10), startsAt: session.startDate,
        startStatus: 'scheduled', participants: [], broadcasts: [], sourceUrl: url }
    })
  })
  const season = {
    id: seasonId, competitionId: competition.id, label: '2026', startsOn: '2026-01-01', endsOn: '2026-12-31',
    sourceUrl: formulaOne.calendar, ...evidence, expectedFixtureIds: fixtures.map(fixture => fixture.id), markets: []
  }
  if (broadcastersHtml) {
    for (const { territory, channelName } of parseFormulaOneBroadcasters(broadcastersHtml)) {
      let market = season.markets.find(row => row.country === territory)
      if (!market) {
        market = { country: territory, sourceUrl: formulaOne.broadcasters, ...evidence,
          expectedListedFixtureIds: [], rightsHolders: [] }
        season.markets.push(market)
      }
      market.rightsHolders.push(channelName)
    }
  }
  return { organizations: [organization], competitions: [competition], seasons: [season], fixtures }
}

function productOffers(value, ids, found) {
  if (!value || typeof value !== 'object') return
  if (ids.has(value.productId) && typeof value.offerPrice === 'string') {
    const prices = found.get(value.productId) ?? new Set()
    prices.add(value.offerPrice)
    found.set(value.productId, prices)
  }
  for (const child of Object.values(value)) productOffers(child, ids, found)
}

export function parseSportsPrices(html, evidence, entitlementsHtml = '') {
  const source = embeddedJson(html, /id=["']__NEXT_DATA__["']/i)[0]
  const products = new Map([
    ['SPORTS_PASS_DAY', { id: 'now-all-sports-day-gb', plan: 'Sports Day Membership', billingPeriod: 'day',
      terms: 'One payment for 24 hours from activation.' }],
    ['ALL_SKY_SPORTS_MONTH_BUNDLE', { id: 'now-all-sports-month-gb', plan: 'All Sky Sports Fully Flexible',
      billingPeriod: 'month', terms: 'Renews after each 30-day viewing period unless cancelled.' }]
  ])
  const found = new Map()
  for (const { data } of Object.values(source?.props?.graphqlState?.data ?? {})) {
    if (typeof data === 'string' && /ALL_SKY_SPORTS_MONTH_BUNDLE|SPORTS_PASS_DAY/.test(data)) {
      const page = JSON.parse(data)?.fetchPage
      if (!page?.atom?.atomConfig?.gb) throw new Error('The pricing page did not declare the GB market')
      productOffers(page.content, products, found)
    }
  }
  if (!/Sports Day Membership gives you instant access to all of Sky Sports for 24 hours/i.test(html) ||
      !/What do I get with a NOW All Sky Sports Membership/i.test(html)) {
    throw new Error('Published subscription coverage could not be verified')
  }
  const entitlements = text(entitlementsHtml)
  const includesPlus = /All 12 Sky Sports channels:[^.]+\bPlus\b/i.test(entitlements) &&
    /Day Membership Everything you get with All Sky Sports Membership/i.test(entitlements)
  const destinations = ['sky-sports', 'sky-sports-main-event', 'sky-sports-premier-league', 'sky-sports-football', 'sky-sports-cricket']
  return [...products].map(([productId, product]) => {
    const prices = found.get(productId)
    const parts = prices?.size === 1 ? [...prices][0].match(/^£(\d{1,4})\.(\d{2})$/) : null
    if (!parts) throw new Error(`Missing or conflicting UK price for ${productId}`)
    return { ...product, provider: 'NOW', country: 'GB', currency: 'GBP',
      amountMinor: Number(parts[1]) * 100 + Number(parts[2]),
      destinationIds: includesPlus ? [...destinations, 'sky-sports-plus'] : destinations,
      ...(includesPlus ? { entitlementSourceUrl: sportsEntitlementsUrl } : {}),
      competitionIds: ['premier-league'], sourceUrl: sportsPricingUrl, ...evidence }
  })
}
