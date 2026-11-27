import { normalizeBroadcastText } from '../broadcast/normalize.mjs'
import { extractFormulaOneRaceLinks, parseFormulaOneBroadcasters } from '../official-f1.mjs'
import { parseSkyFixtureSchedule, skyLocalKickoff } from '../broadcast/sky-fixtures.mjs'

export const premierLeague = {
  fixtures: 'https://www.premierleague.com/en/news/4675097/all-380-fixtures-for-the-202627-premier-league-season',
  roster: 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams?limit=40',
  scoreboard: 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard',
  januaryAmendments: 'https://www.premierleague.com/en/news/4764482/fixture-amendments-for-premier-league-matches-in-january-and-early-february',
  seasonAnnouncement: 'https://www.premierleague.com/en/news/4675508/fixture-schedulereleased-for-season-202627'
}
export const formulaOne = {
  calendar: 'https://www.formula1.com/en/racing/2026',
  broadcasters: 'https://www.formula1.com/en/information/f1-broadcasters.1eqG3L8AlJATj7icjBtrfN',
  ukListings: 'https://www.skysports.com/watch/f1-on-sky',
  ukFinaleListings: 'https://www.skysports.com/watch/f1-on-sky/grand-prix/abu-dhabi',
  usListings: 'https://tv.apple.com/us/channel/formula-1/tvs.sbd.241000',
  usEntitlements: 'https://tv.apple.com/us/info/watch-f1',
  usPricing: 'https://www.apple.com/apple-tv/'
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

export function parsePremierLeague(html, roster, evidence, sourceUrl = premierLeague.fixtures) {
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
  const confirmedDefault = /All fixtures are GMT and are 15:00 kick-offs unless otherwise stated/i.test(text(article))
  const fixtureBlocks = [...article.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
  for (const [, block] of fixtureBlocks) {
    const lines = block.replace(/<br\s*\/?\s*>/gi, '\n').split('\n').map(text).filter(Boolean)
    const heading = lines.shift()?.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) (\d{1,2}) ([a-z]+)(?: (20\d{2}))?$/i)
    if (!heading) continue
    const [, weekday, day, monthName, year] = heading
    const month = MONTHS.indexOf(monthName.toLowerCase()) + 1
    if (!month) throw new Error(`Unrecognized fixture month ${monthName}`)
    const date = isoDate(year ?? (month >= 8 ? '2026' : '2027'), month, day)
    const defaultTime = confirmedDefault || /^(Saturday|Sunday)$/i.test(weekday) ? '15:00' : null
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
        startStatus: kickoff || confirmedDefault ? 'scheduled' : time ? 'provisional' : 'unannounced',
        sourceUrl,
        participants: [{ organizationId: home.id, role: 'home' }, { organizationId: away.id, role: 'away' }],
        broadcasts: network ? [{
          country: 'GB', destinationId: slug(network), name: network, type: 'network', kind: 'live',
          airsAt: null, sourceUrl, ...evidence
        }] : []
      })
    }
  }
  const season = {
    id: seasonId, competitionId: competition.id, label: '2026/27', startsOn: '2026-08-01', endsOn: '2027-05-31',
    sourceUrl, ...evidence, expectedFixtureIds,
    markets: [{ country: 'GB', sourceUrl, ...evidence,
      expectedListedFixtureIds: fixtures.filter(fixture => fixture.broadcasts.length).map(fixture => fixture.id) }]
  }
  return { organizations: [organization, ...clubs], competitions: [competition], seasons: [season], fixtures }
}

function orderedMatchup(participants) {
  return ['home', 'away'].map(role => participants.find(row => row.role === role)?.organizationId).join('/')
}

export function applyPremierLeagueAmendments(batch, amendments) {
  const changed = new Map()
  for (const row of amendments) {
    if (row.startStatus !== 'scheduled') continue
    if (changed.has(row.id)) throw new Error(`Duplicate amendment for ${row.id}`)
    changed.set(row.id, row)
  }
  const ids = new Set(batch.fixtures.map(row => row.id))
  if ([...changed.keys()].some(id => !ids.has(id))) throw new Error('Amendment for a fixture outside the season')
  for (const fixture of batch.fixtures) {
    const update = changed.get(fixture.id)
    if (!update) continue
    const stillMatches = fixture.startsAt === update.startsAt
    const broadcasts = update.broadcasts.length || !stillMatches ? update.broadcasts : fixture.broadcasts
    Object.assign(fixture, { date: update.date, startsAt: update.startsAt, startStatus: update.startStatus,
      sourceUrl: update.sourceUrl, broadcasts })
  }
}

export function applyPremierLeagueFinalDay(batch, html) {
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? ''
  const time = text(article).match(/season will finish on Sunday 30 May 2027, with all matches kicking off at (\d{2}:\d{2})/i)?.[1]
  const finalDay = batch.fixtures.filter(row => row.date === '2027-05-30')
  if (!time || finalDay.length !== 10) throw new Error('The final matchday could not be reconciled')
  const startsAt = londonTime('2027-05-30', time)
  for (const fixture of finalDay) {
    if (fixture.startStatus === 'scheduled' && fixture.startsAt !== startsAt) continue
    if (fixture.startStatus !== 'scheduled') Object.assign(fixture, {
      startsAt, startStatus: 'scheduled', sourceUrl: premierLeague.seasonAnnouncement
    })
  }
}

export function applyCompletedPremierLeagueResults(batch, scoreboards, now = Date.now()) {
  const played = new Map()
  const clubIds = new Map(batch.organizations.filter(row => row.kind === 'club')
    .map(row => [teamKey(row.name), row.id]))
  const londonDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/London', dateStyle: 'short' })
  for (const [month, scoreboard] of scoreboards) {
    if (!scoreboard.leagues?.some(row => row.slug === 'eng.1')) continue
    for (const event of scoreboard.events ?? []) {
      const game = event.competitions?.[0]
      const time = Date.parse(game?.date)
      if (event.season?.year !== 2026 || game?.timeValid !== true || game.status?.type?.completed !== true ||
          game.status.type.state !== 'post' || !Number.isFinite(time) || time >= now) continue
      const pair = ['home', 'away'].map(role => game.competitors?.find(row => row.homeAway === role)?.team?.displayName)
        .map(name => clubIds.get(teamKey(name)))
      if (pair.some(id => !id) || pair[0] === pair[1]) continue
      const key = pair.join('/')
      const startsAt = new Date(time).toISOString()
      const match = { startsAt, sourceUrl: `${premierLeague.scoreboard}?dates=${month}&limit=300` }
      const previous = played.get(key)
      played.set(key, previous === undefined || previous?.startsAt === startsAt ? match : null)
    }
  }
  for (const fixture of batch.fixtures) {
    if (!['provisional', 'unannounced'].includes(fixture.startStatus) ||
        Date.parse(fixture.date) >= now) continue
    const result = played.get(orderedMatchup(fixture.participants))
    if (!result) continue
    const date = londonDate.format(new Date(result.startsAt))
    if (date !== fixture.date) continue
    Object.assign(fixture, result, { startStatus: 'scheduled' })
  }
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

function racingFixtureIndex(fixtures) {
  const byIdentity = new Map()
  const raceNames = new Set()
  for (const fixture of fixtures) {
    const [session, race] = fixture.title.split(/\s+-\s+/)
    if (!race) continue
    const name = slug(race).replace(/-grand-prix$/, '')
    raceNames.add(name)
    const key = `${name}/${slug(session)}/${Date.parse(fixture.startsAt)}`
    byIdentity.set(key, byIdentity.has(key) ? null : fixture)
  }
  return { byIdentity, raceNames }
}

function recordRacingMarket(batch, country, sourceUrl, evidence, matched) {
  if (matched.size === 0) return
  const season = batch.seasons[0]
  const market = season.markets.find(row => row.country === country)
  const listed = { ...evidence, country, sourceUrl,
    expectedListedFixtureIds: [...new Set([...(market?.expectedListedFixtureIds ?? []), ...matched])] }
  if (market) Object.assign(market, listed)
  else season.markets.push(listed)
}

export function addFormulaOneUkListings(batch, pages, evidence) {
  const { byIdentity, raceNames } = racingFixtureIndex(batch.fixtures)
  const matched = new Set()
  const referenceYear = new Date(evidence.verifiedAt).getUTCFullYear()
  const londonWeekday = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short' })
  for (const [url, html] of pages) {
    for (const section of html.split(/(?=<h3\b[^>]*>)/i)) {
      const heading = text(section.match(/^<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? '')
      const date = heading.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{1,2})(?:st|nd|rd|th) ([A-Za-z]+)$/)
      if (!date) continue
      const month = MONTHS.indexOf(date[3].toLowerCase())
      if (month === -1) continue
      for (const block of section.split(/<div\b[^>]*class=["'][^"']*\bevent-group\b[^"']*["'][^>]*>/i).slice(1)) {
        const title = text(block.match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i)?.[1] ?? '')
        const identity = title.match(/^(.+?) GP - (Practice [1-3]|Qualifying 1|Race)$/i)
        const detail = text(block.match(/<p\b[^>]*class=["'][^"']*\bevent-detail\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? '')
        const airing = detail.match(/^(Sky Sports F1 HD) \((\d{1,2}):(\d{2})\)$/i)
        if (!identity || !airing) continue
        const time = skyLocalKickoff(referenceYear, month, Number(date[2]), Number(airing[2]), Number(airing[3]))
        if (time === null || londonWeekday.format(time * 1000) !== date[1]) continue
        const session = identity[2].toLowerCase().startsWith('qualifying') ? 'qualifying' : slug(identity[2])
        const label = slug(identity[1])
        const races = [...raceNames].filter(name => label === name || label.endsWith(`-${name}`))
        if (races.length !== 1) continue
        const fixture = byIdentity.get(`${races[0]}/${session}/${time * 1000}`)
        if (!fixture || matched.has(fixture.id)) continue
        fixture.broadcasts.push({ ...evidence, country: 'GB', destinationId: 'sky-sports-f1-hd',
          name: airing[1], type: 'channel', kind: 'live', airsAt: new Date(time * 1000).toISOString(), sourceUrl: url })
        matched.add(fixture.id)
      }
    }
  }
  recordRacingMarket(batch, 'GB', formulaOne.ukListings, evidence, matched)
}

export function addFormulaOneUsListings(batch, html, evidence) {
  const [data] = embeddedJson(html, /id=["']serialized-server-data["']/i)
  if (!data) throw new Error('US racing programme data is missing')
  const { byIdentity } = racingFixtureIndex(batch.fixtures)
  const candidates = new Map()

  function inspect(value) {
    if (!value || typeof value !== 'object') return
    if (value.leagueName === 'Formula 1' && value.feedName === 'Main Broadcast' && value.airingType === 'Live') {
      const match = typeof value.shortTitle === 'string' && value.shortTitle.match(/^([^:]+):\s*(Practice\s*[1-3]|Sprint Qualifying|Qualifying|Sprint|Race)$/i)
      const kickoff = value.eventTime?.gameKickOffStartTime
      const start = value.eventTime?.playerInfoDisplayTime?.startTime
      const verified = Array.isArray(value.playables) && value.playables.some(playable => playable.externalServiceId === 'com.apple.f1.svod.ebs.US' &&
        /^F1_\d+_NATIONAL$/.test(playable.externalId ?? '') &&
        playable.eventTime?.gameKickOffStartTime === kickoff &&
        playable.eventTime?.playerInfoDisplayTime?.startTime === start)
      if (match && verified && Number.isSafeInteger(kickoff) && Number.isSafeInteger(start) &&
          start === value.eventTime.liveBadgeTime?.startTime && start <= kickoff && kickoff - start <= 2 * 3600_000 &&
          /^https:\/\/tv\.apple\.com\/us\/sporting-event\/[a-z0-9-]+\/umc\.cse\.[a-z0-9]+(?:\?|$)/.test(value.url ?? '')) {
        const fixture = byIdentity.get(`${slug(match[1])}/${slug(match[2])}/${kickoff}`)
        if (fixture) {
          const previous = candidates.get(fixture.id)
          const airing = { ...evidence, country: 'US', destinationId: 'apple-tv-us', name: 'Apple TV',
            type: 'service', kind: 'live', airsAt: new Date(start).toISOString(), sourceUrl: value.url.split('?')[0] }
          candidates.set(fixture.id, previous === undefined || previous?.airsAt === airing.airsAt ? airing : null)
        }
      }
    }
    for (const child of Object.values(value)) inspect(child)
  }

  inspect(data)
  const matched = new Set()
  for (const fixture of batch.fixtures) {
    const airing = candidates.get(fixture.id)
    if (!airing) continue
    fixture.broadcasts.push(airing)
    matched.add(fixture.id)
  }
  recordRacingMarket(batch, 'US', formulaOne.usListings, evidence, matched)
}

export function parseFormulaOneUsPrices(pricingHtml, entitlementsHtml, evidence, fixtures = []) {
  const entitlements = text(entitlementsHtml)
  if (!/every Free Practice, Qualifying session, Sprint, and Grand Prix available to Apple TV subscribers in the U\.S\./i
    .test(entitlements)) throw new Error('US racing subscription coverage could not be verified')
  const price = text(pricingHtml).match(/A monthly subscription is just \$(\d{1,4})\.(\d{2})\s*per month/i)
  if (!price) throw new Error('The standard USD monthly price could not be verified')
  const monthly = { ...evidence, id: 'apple-tv-monthly-us', provider: 'Apple TV', country: 'US', currency: 'USD',
    plan: 'Standard Monthly Subscription', amountMinor: Number(price[1]) * 100 + Number(price[2]),
    billingPeriod: 'month', terms: 'Standard monthly price. Renews until cancelled.',
    destinationIds: ['apple-tv-us'], competitionIds: ['formula-1'], sourceUrl: formulaOne.usPricing,
    entitlementSourceUrl: formulaOne.usEntitlements }
  const practiceIds = fixtures.filter(row => /^Practice [1-3] - /i.test(row.title) &&
    row.broadcasts.some(airing => airing.country === 'US' && airing.destinationId === 'apple-tv-us'))
    .map(row => row.id)
  if (!practiceIds.length || !/Every practice is available without a subscription/i.test(entitlements)) return [monthly]
  return [monthly, { ...monthly, id: 'apple-tv-live-practice-us', plan: 'Live Practice', amountMinor: 0,
    billingPeriod: 'free', terms: 'Live practice is available without a subscription in the US.',
    sourceUrl: formulaOne.usEntitlements, fixtureIds: practiceIds }]
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
  const dayIncludesAllSports = /Day Membership Everything you get with All Sky Sports Membership/i.test(entitlements)
  const includesPlus = dayIncludesAllSports && /All 12 Sky Sports channels:[^.]+\bPlus\b/i.test(entitlements)
  const includesFormulaOne = dayIncludesAllSports && /All 12 Sky Sports channels:[^.]+\bF1\b/i.test(entitlements)
  const destinations = ['sky-sports', 'sky-sports-main-event', 'sky-sports-premier-league', 'sky-sports-football', 'sky-sports-cricket']
  if (includesPlus) destinations.push('sky-sports-plus')
  if (includesFormulaOne) destinations.push('sky-sports-f1-hd')
  return [...products].map(([productId, product]) => {
    const prices = found.get(productId)
    const parts = prices?.size === 1 ? [...prices][0].match(/^£(\d{1,4})\.(\d{2})$/) : null
    if (!parts) throw new Error(`Missing or conflicting UK price for ${productId}`)
    return { ...product, provider: 'NOW', country: 'GB', currency: 'GBP',
      amountMinor: Number(parts[1]) * 100 + Number(parts[2]),
      destinationIds: destinations,
      ...(includesPlus || includesFormulaOne ? { entitlementSourceUrl: sportsEntitlementsUrl } : {}),
      competitionIds: includesFormulaOne ? ['premier-league', 'formula-1'] : ['premier-league'], sourceUrl: sportsPricingUrl, ...evidence }
  })
}
