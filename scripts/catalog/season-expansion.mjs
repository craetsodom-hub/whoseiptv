import { skyLocalKickoff } from '../broadcast/sky-fixtures.mjs'
import { SUPPORTED_TERRITORIES } from '../territories.mjs'
import { isDate, isTimestamp } from './model.mjs'

export const nba = {
  schedule: 'https://stats.nba.com/stats/scheduleleaguev2?LeagueID=00&Season=2026-27',
  scheduleCdn: 'https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_1.json',
  announcement: 'https://www.nba.com/news/2026-27-nba-regular-season-schedule',
  primePricing: 'https://www.aboutamazon.com/news/entertainment/stream-nba-prime-video'
}
export const sixNations = {
  men: {
    fixtures: 'https://www.sixnationsrugby.com/en/m6n/fixtures/202700',
    rights: 'https://www.sixnationsrugby.com/en/m6n/where-to-watch-guinness-six-nations',
    competitionId: 'mens-six-nations', name: "Men's Six Nations", siteCode: 'm6n',
    logoAlt: "Guinness Men's Six Nations Transparent Main Logo Image", teamAffix: ''
  },
  women: {
    fixtures: 'https://www.sixnationsrugby.com/en/w6n/fixtures/202700',
    rights: 'https://www.sixnationsrugby.com/en/w6n/where-to-watch-guinness-womens-six-nations',
    competitionId: 'womens-six-nations', name: "Women's Six Nations", siteCode: 'w6n',
    logoAlt: 'Guinness Womens Six Nations W6N transparent logo Image', teamAffix: 'women-'
  }
}
export const ashes = {
  fixtures: 'https://www.ecb.co.uk/news/4539854',
  broadcasts: 'https://www.skysports.com/cricket/news/12340/13585807/australias-steve-smith-on-2027-ashes-series-in-england-i-dont-even-know-if-ill-be-there-yet',
  australia: 'https://www.cricketaustralia.com.au/'
}
export const australianOpen = {
  dates: 'https://ausopen.com/articles/news/australian-open-2027-dates-announced',
  organizer: 'https://www.tennis.com.au/',
  rights: 'https://ausopen.com/articles/news/australian-open-renews-longstanding-broadcast-partnership-sky-new-zealand'
}

function siteLogo(url, sourceUrl) {
  return { url: new URL(url, sourceUrl).href, sourceUrl }
}

function decodeText(value) {
  return value.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/(?:&nbsp;|\u00a0)/g, ' ')
    .replace(/(?:&#x27;|&#39;|&rsquo;)/g, "'").replace(/\s+/g, ' ').trim()
}

function fixtureBatch(competition, organizations, edition, fixtures) {
  return {
    competitions: [competition], organizations, fixtures,
    seasons: [{ ...edition, competitionId: competition.id, expectedFixtureIds: fixtures.map(row => row.id) }]
  }
}

const usNbaChannels = new Set(['ABC', 'ESPN', 'ESPN2', 'NBC', 'NBC Sports Network', 'NBA TV', 'Telemundo', 'Disney Channel'])
const usNbaServices = new Set(['Peacock', 'Prime Video', 'Disney+'])

export function nbaPrimeOffers(batch, html, evidence) {
  const article = decodeText(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, ' '))
  const prices = article.match(/Prime Video is included with a Prime membership\s*, which costs \$(\d+(?:\.\d{2})?) a month or \$(\d+(?:\.\d{2})?) a year/i)
  if (!prices || !/2026[-–]27 NBA season on Prime Video/i.test(article)) return []
  const ids = new Set(batch.fixtures.flatMap(row => row.broadcasts
    .filter(b => b.country === 'US' && b.name === 'Prime Video' && b.type === 'service').map(b => b.destinationId)))
  if (!ids.size) return []
  return ['month', 'year'].map((period, i) => ({
    ...evidence, id: 'us-prime-nba-' + period, provider: 'Amazon', plan: 'Prime', country: 'US',
    billingPeriod: period, currency: 'USD', amountMinor: Math.round(Number(prices[i + 1]) * 100),
    competitionIds: ['nba'], destinationIds: [...ids], sourceUrl: nba.primePricing,
    entitlementSourceUrl: nba.primePricing, terms: 'Standard US Prime membership for games listed on Prime Video.'
  }))
}

export function parseNbaSeason(schedule, announcement, evidence, scheduleUrl = nba.schedule) {
  const league = schedule?.leagueSchedule
  if (league?.seasonYear !== '2026-27' || league.leagueId !== '00' || !Array.isArray(league.gameDates)) {
    throw new Error('Unexpected NBA schedule edition')
  }
  const sourceTime = Date.parse(schedule.meta?.time)
  const checkedTime = Date.parse(evidence.verifiedAt)
  if (!Number.isFinite(sourceTime) || sourceTime > checkedTime || checkedTime - sourceTime >= 24 * 60 * 60 * 1000) {
    throw new Error('NBA schedule response has an out-of-date generation time')
  }
  const verifiedUntil = new Date(Math.min(Date.parse(evidence.validUntil), sourceTime + 24 * 60 * 60 * 1000)).toISOString()
  evidence = { ...evidence, validUntil: verifiedUntil }
  const logos = new Map()
  for (const [, url, id, name] of announcement.matchAll(/<img src="(https:\/\/cdn\.nba\.com\/logos\/nba\/(\d+)\/primary\/L\/logo\.svg)" title="([^"]+) Logo"/g)) {
    logos.set(Number(id), { name: decodeText(name), logo: siteLogo(url, nba.announcement) })
  }
  const leagueLogo = announcement.match(/<img src="(https:\/\/cdn\.nba\.com\/logos\/leagues\/logo-nba\.svg)" alt="NBA Logo"/)?.[1]
  if (logos.size !== 30 || !leagueLogo) throw new Error('Incomplete NBA logo inventory')
  const seasonId = 'nba-2026-27'
  const organizer = { id: 'nba-organization', name: 'National Basketball Association', kind: 'organizer',
    country: 'US', logo: siteLogo(leagueLogo, nba.announcement) }
  const teams = [...logos].map(([id, team]) => ({
    ...team, id: 'nba-team-' + id, kind: 'club', country: id === 1610612761 ? 'CA' : 'US'
  }))
  const byTeam = new Map(teams.map(row => [row.id, row]))
  const fixtures = league.gameDates.flatMap(day => day.games).filter(game => /^00226\d{5}$/.test(game.gameId))
    .map(game => {
      const home = byTeam.get('nba-team-' + game.homeTeam?.teamId)
      const away = byTeam.get('nba-team-' + game.awayTeam?.teamId)
      const date = game.gameDateEst?.slice(0, 10)
      const undecided = /^(?:TBD|TBA)$/i.test(game.gameStatusText?.trim() ?? '')
      const pendingTeams = game.gameLabel === 'Emirates NBA Cup' && game.gameStatus === 1
      if ((!pendingTeams && (!home || !away)) || !isDate(date) || (!undecided && !isTimestamp(game.gameDateTimeUTC)) ||
          ![1, 2, 3].includes(game.gameStatus) || !['N', 'P'].includes(game.postponedStatus)) {
        throw new Error('Unexpected NBA fixture ' + game.gameId)
      }
      const postponed = game.postponedStatus === 'P'
      const broadcasts = new Map()
      for (const row of game.broadcasters?.nationalBroadcasters ?? []) {
        const name = row.broadcasterDisplay
        const type = usNbaServices.has(name) ? 'service' : usNbaChannels.has(name) ? 'channel' : null
        if (!type || row.tapeDelayComments) continue
        if (row.localizationRegion && !['National', 'East', 'West'].includes(row.localizationRegion)) continue
        const region = ['East', 'West'].includes(row.localizationRegion) ? ' (' + row.localizationRegion + ')' : ''
        const destinationId = name === 'Peacock' ? 'peacock-us' : 'nba-us-' + row.broadcasterId
        broadcasts.set(destinationId, { ...evidence, sourceUrl: scheduleUrl, country: 'US', destinationId,
          name: name + region, type, kind: 'live', airsAt: null })
      }
      const participants = []
      if (home) participants.push({ organizationId: home.id, role: 'home' })
      if (away) participants.push({ organizationId: away.id, role: 'away' })
      return {
        id: 'nba-' + game.gameId, seasonId, date,
        title: home && away ? away.name + ' at ' + home.name : game.gameLabel + ' ' + game.gameSubLabel,
        startsAt: postponed || undecided ? null : game.gameDateTimeUTC,
        startStatus: postponed ? 'postponed' : undecided ? 'unannounced' : 'scheduled',
        sourceUrl: scheduleUrl, ...(!game.isNeutral && home ? { venueCountry: home.country } : {}), participants,
        broadcasts: postponed ? [] : [...broadcasts.values()]
      }
    })
  if (fixtures.length < 1206 || fixtures.length > 1230 || new Set(fixtures.map(row => row.id)).size !== fixtures.length) {
    throw new Error('Unexpected number of NBA regular-season fixtures')
  }
  return fixtureBatch({ id: 'nba', name: 'NBA', sport: 'basketball', kind: 'league',
    leagueCountry: 'US', organizerId: organizer.id, logo: organizer.logo }, [organizer, ...teams], {
    ...evidence, id: seasonId, label: '2026/27 regular season', sourceUrl: scheduleUrl,
    startsOn: '2026-10-20', endsOn: '2027-04-11', expectedFixtureCount: 1230,
    markets: [{ ...evidence, country: 'US', sourceUrl: scheduleUrl,
      expectedListedFixtureIds: fixtures.filter(row => row.broadcasts.length).map(row => row.id) }]
  }, fixtures)
}

const rugbyTeams = new Map([
  ['England', ['ENG', 'GB']], ['France', ['FRA', 'FR']], ['Ireland', ['IRE', null]],
  ['Italy', ['ITA', 'IT']], ['Scotland', ['SCO', 'GB']], ['Wales', ['WAL', 'GB']]
])

export function parseSixNations(edition, fixturesHtml, rightsHtml, evidence) {
  const chunks = [...fixturesHtml.matchAll(/self\.__next_f\.push\((\[1,"(?:\\.|[^"\\])*"\])\)<\/script>/g)]
  const data = chunks.map(([, chunk]) => JSON.parse(chunk)[1]).join('')
  const seasonId = edition.competitionId + '-2027'
  const logos = new Map([...data.matchAll(/"url":"(https:\/\/images\.ctfassets\.net\/[^"]+\.png)","alt":"([^"]+)"/g)]
    .map(([, url, label]) => [label, siteLogo(url, edition.fixtures)]))
  const organizations = [...rugbyTeams].map(([name, [code, country]]) => ({
    id: 'six-nations-' + edition.teamAffix + code.toLowerCase(), kind: 'team',
    name: edition.teamAffix ? name + ' Women' : name, country, logo: logos.get(code)
  }))
  const competitionLogo = logos.get(edition.logoAlt)
  if (!competitionLogo || organizations.some(row => !row.logo)) throw new Error('Incomplete Six Nations badges')
  const organizerIcon = fixturesHtml.match(/<link rel="icon" href="(\/icon\.svg[^"]*)"/)?.[1]
  const organizer = { id: 'six-nations-rugby', name: 'Six Nations Rugby', kind: 'organizer', country: null,
    ...(organizerIcon ? { logo: siteLogo(organizerIcon, 'https://www.sixnationsrugby.com/') } : {}) }
  const teams = new Map([...rugbyTeams.keys()].map((name, index) => [name.toLowerCase(), organizations[index]]))
  const fixtures = []
  const matchups = new Set()
  const records = data.split(/"format":"HH:mm","date":"/).slice(1)
  for (const record of records) {
    const startsAt = record.split('"', 1)[0]
    const match = record.match(/"href":"(\/en\/(m6n|w6n)\/fixtures\/202700\/([a-z]+)(?:-women)?-v-([a-z]+)(?:-women)?-\d{8}-\d{4}\/build-up)"/)
    const home = teams.get(match?.[3])
    const away = teams.get(match?.[4])
    if (!isTimestamp(startsAt) || match?.[2] !== edition.siteCode || !home || !away || home.id === away.id) {
      throw new Error('Unexpected Six Nations fixture card')
    }
    const [, href, , homeSlug, awaySlug] = match
    const pair = [homeSlug, awaySlug].sort().join('/')
    if (matchups.has(pair)) throw new Error('Duplicate Six Nations matchup ' + pair)
    matchups.add(pair)
    fixtures.push({
      id: seasonId + '-' + homeSlug + '-v-' + awaySlug, seasonId,
      title: home.name + ' v ' + away.name, date: startsAt.slice(0, 10), startsAt, startStatus: 'scheduled',
      sourceUrl: new URL(href, edition.fixtures).href,
      venueCountry: homeSlug === 'ireland' ? 'IE' : home.country,
      participants: [{ organizationId: home.id, role: 'home' }, { organizationId: away.id, role: 'away' }],
      broadcasts: []
    })
  }
  if (fixtures.length !== 15) throw new Error('Incomplete Six Nations match schedule')

  const rightsByCountry = new Map()
  const ukRows = []
  for (const [, label, providers] of rightsHtml.matchAll(/<tr>\s*<td(?: [^>]*)?>(.*?)<\/td>\s*<td(?: [^>]*)?>(.*?)<\/td>\s*<\/tr>/gs)) {
    const name = decodeText(label)
    const country = rugbyMarketCodes.get(name)
    if (!country) continue
    const names = [...providers.matchAll(/<a\b[^>]*>(.*?)<\/a>/gs)].map(([, value]) => decodeText(value)).filter(Boolean)
    if (!names.length) continue
    if (country === 'GB') {
      ukRows.push(names)
      continue
    }
    rightsByCountry.set(country, [...new Set([...(rightsByCountry.get(country) ?? []), ...names])])
  }
  if (ukRows.length === 4) {
    const common = ukRows[0].filter(provider => ukRows.every(names => names.includes(provider)))
    if (common.length) rightsByCountry.set('GB', common)
  }
  const markets = [...rightsByCountry].map(([country, rightsHolders]) => ({
    ...evidence, sourceUrl: edition.rights, country, rightsHolders, expectedListedFixtureIds: []
  }))
  return fixtureBatch({ id: edition.competitionId, name: edition.name, sport: 'rugby', kind: 'tournament',
    leagueCountry: null, organizerId: organizer.id, logo: competitionLogo },
  [organizer, ...organizations], {
    ...evidence, sourceUrl: edition.fixtures, id: seasonId, label: '2027', startsOn: fixtures[0].date,
    endsOn: fixtures.at(-1).date, markets
  }, fixtures)
}

const territoryNames = new Intl.DisplayNames(['en'], { type: 'region' })
const rugbyMarketCodes = new Map([
  ...[...SUPPORTED_TERRITORIES].map(code => [territoryNames.of(code), code]),
  ...Object.entries({
    England: 'GB', Scotland: 'GB', Wales: 'GB', 'Northern Ireland': 'GB', 'United States of America': 'US',
    'Hong Kong': 'HK', Macau: 'MO', 'Cape Verde': 'CV', 'Congo (Republic of)': 'CG',
    'Democratic Republic of Congo': 'CD', "Cote d'Ivoire": 'CI', Reunion: 'RE', 'Sao Tome & Principe': 'ST',
    'Somalia (inc Somaliland)': 'SO', 'St. Helena and Ascension': 'SH', Swaziland: 'SZ', Tanazania: 'TZ',
    'Porto Rico': 'PR', Nicargua: 'NI', 'St Lucia': 'LC', 'West Bank and Gaza': 'PS', Palestine: 'PS'
  })
])

const cricketTeamBadges = Object.fromEntries([
  ['england-men', 137142, 'y5wcl81646775152'], ['australia-men', 137146, 'zvm8581646775132'],
  ['england-women', 145688, 'av4o8u1646775500'], ['australia-women', 145686, 'e5po1e1646775485']
].map(([team, id, asset]) => [team, {
  url: 'https://r2.thesportsdb.com/images/media/team/badge/' + asset + '.png',
  sourceUrl: 'https://www.thesportsdb.com/team/' + id
}]))

export function parseAshes(fixturesHtml, broadcastsHtml, australiaHtml, evidence) {
  const sections = new Map([...fixturesHtml.matchAll(/<p><strong>England (Men|Women) v Australia[^<]+Ashes[^<]*<\/strong><\/p>((?:\s*<p>(?!<strong>)[\s\S]*?<\/p>)+)/g)]
    .map(([, division, html]) => [division, html]))
  const hasSky = /All games live on Sky Sports, all 11am starts UK and Ireland/i.test(broadcastsHtml)
  const homeSeriesOnSky = /Every England Men's and Women's match of the 2027 international summer will be shown live on Sky/i
    .test(decodeText(fixturesHtml.replace(/’/g, "'")))
  const ecb = { id: 'england-and-wales-cricket-board', name: 'England and Wales Cricket Board', kind: 'federation',
    country: 'GB', logo: siteLogo('/resources/v2.2.24/apple-touch-icon.png', ashes.fixtures) }
  const caLogo = australiaHtml.match(/<img[^>]+src="(https:\/\/[^"]*\/CricketAustraliaLogoWhiteWide\.svg)"[^>]+alt="Return to Homepage"/)?.[1]
  const ca = { id: 'cricket-australia', name: 'Cricket Australia', kind: 'federation', country: 'AU',
    ...(caLogo ? { logo: siteLogo(caLogo, ashes.australia) } : {}) }
  const months = { June: '06', July: '07', August: '08' }
  const formats = new Map([
    ['Rothesay Ashes Test', ['test', 'Test']], ['Rothesay Ashes Test match', ['test', 'Test']],
    ['Vitality IT20', ['t20i', 'T20I']], ['Metro Bank ODI', ['odi', 'ODI']]
  ])
  return ['Men', 'Women'].map(division => {
    const section = sections.get(division)
    if (!section) throw new Error('Missing Ashes fixture list for ' + division)
    const suffix = division.toLowerCase()
    const editionName = division + "'s Ashes"
    const competitionId = suffix + 's-ashes'
    const seasonId = competitionId + '-2027'
    const england = { id: 'england-cricket-' + suffix, name: 'England ' + division, kind: 'team', country: 'GB',
      logo: cricketTeamBadges['england-' + suffix] }
    const australia = { id: 'australia-cricket-' + suffix, name: 'Australia ' + division, kind: 'team', country: 'AU',
      logo: cricketTeamBadges['australia-' + suffix] }
    const markets = division === 'Men' && hasSky ? ['GB', 'IE'] : homeSeriesOnSky ? ['GB'] : []
    const broadcastSource = division === 'Men' && hasSky ? ashes.broadcasts : ashes.fixtures
    const fixtures = []
    for (const line of section.split(/<br\s*\/?>|<\/p>/i).map(decodeText)) {
      const row = line.match(/^\w+ (\d{1,2})(?: (June|July))?(?: [–-] (\d{1,2}))? (June|July|August): (\d)(?:st|nd|rd|th) ([^–-]+) [–-] (.+),\s*(\d{4})$/)
      if (!row) continue
      const [, day, month, lastDay, lastMonth, number, format, venue, time] = row
      const [formatId, formatName] = formats.get(format) ?? []
      if (!formatId) continue
      const date = '2027-' + months[month ?? lastMonth] + '-' + day.padStart(2, '0')
      const endsOn = lastDay ? '2027-' + months[lastMonth] + '-' + lastDay.padStart(2, '0') : date
      const [, monthIndex, dayOfMonth] = date.split('-').map(Number)
      const start = skyLocalKickoff(2027, monthIndex - 1, dayOfMonth, Number(time.slice(0, 2)), Number(time.slice(2)))
      if (start === null || !isDate(endsOn) || endsOn < date) throw new Error('Unexpected Ashes fixture date')
      fixtures.push({
        id: seasonId + '-' + formatId + '-' + number, seasonId,
        title: england.name + ' v ' + australia.name + ', ' + formatName + ' ' + number,
        date, endsOn, venue, venueCountry: 'GB', startsAt: new Date(start * 1000).toISOString(),
        startStatus: 'scheduled', sourceUrl: ashes.fixtures,
        participants: [{ organizationId: england.id, role: 'home' }, { organizationId: australia.id, role: 'away' }],
        broadcasts: markets.map(country => ({ ...evidence, sourceUrl: broadcastSource, country,
          destinationId: 'sky-sports', name: 'Sky Sports', type: 'network', kind: 'live', airsAt: null }))
      })
    }
    if (fixtures.length !== (division === 'Men' ? 5 : 7) ||
        new Set(fixtures.map(row => row.id)).size !== fixtures.length) {
      throw new Error('Incomplete ' + editionName + ' schedule')
    }
    return fixtureBatch({ id: competitionId, name: editionName, sport: 'cricket', kind: 'series',
      leagueCountry: 'GB', organizerId: ecb.id }, [ecb, ca, england, australia], {
      ...evidence, id: seasonId, label: '2027', sourceUrl: ashes.fixtures, startsOn: fixtures[0].date,
      endsOn: fixtures.at(-1).endsOn, markets: markets.map(country => ({
        ...evidence, country, sourceUrl: broadcastSource, expectedListedFixtureIds: fixtures.map(row => row.id)
      }))
    }, fixtures)
  })
}

export function parseAustralianOpen(datesHtml, organizerHtml, rightsHtml, evidence, { datesOnly = false } = {}) {
  if (!/set for Melbourne Park on 10[–-]31 January/i.test(datesHtml) ||
      !/Main-draw action at AO 2027 begins 17 January/i.test(datesHtml)) {
    throw new Error('Australian Open dates require a fresh source check')
  }
  const logoPath = organizerHtml.match(/data-cmp-filereference="([^"]+\/ao-brand-logo\.svg)"/)?.[1]
  const organizerLogo = organizerHtml.match(/"logo":\{"@type":"ImageObject","url":"(https:\/\/www\.tennis\.com\.au\/[^"]+logo[^"]*\.svg)"/)?.[1]
  if (!datesOnly && (!logoPath || !organizerLogo)) throw new Error('Missing Australian Open or Tennis Australia logo')
  const organizer = { id: 'tennis-australia', name: 'Tennis Australia', kind: 'federation', country: 'AU',
    ...(organizerLogo && { logo: siteLogo(organizerLogo, australianOpen.organizer) }) }
  const nzConfirmed = /from 2027 fans will also be able to enjoy free-to-air evening session coverage on Three and ThreeNow/i.test(rightsHtml) &&
    /Sky Sport and Sky Sport Now/.test(rightsHtml)
  const markets = nzConfirmed ? [{ ...evidence, sourceUrl: australianOpen.rights, country: 'NZ',
    rightsHolders: ['Sky Sport', 'Sky Sport Now', 'Three', 'ThreeNow'], expectedListedFixtureIds: [] }] : []
  return fixtureBatch({ id: 'australian-open', name: 'Australian Open', sport: 'tennis', kind: 'tournament',
    leagueCountry: 'AU', organizerId: organizer.id, ...(logoPath && { logo: siteLogo(logoPath, australianOpen.organizer) }) }, [organizer], {
    ...evidence, id: 'australian-open-2027', label: '2027', sourceUrl: australianOpen.dates,
    startsOn: '2027-01-10', endsOn: '2027-01-31', fixtureInventoryStatus: 'unannounced', markets
  }, [])
}
