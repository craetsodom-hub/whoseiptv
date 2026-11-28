import { isDate, isTimestamp } from './model.mjs'
import { updateMarket } from './european-leagues.mjs'
import { isSupportedTerritory } from '../territories.mjs'

const mlbSource =
  'https://statsapi.mlb.com/api/v1/schedule?sportId=1&season=2027&gameTypes=R&hydrate=broadcasts(all),venue(location)'
const mlbTeams = 'https://statsapi.mlb.com/api/v1/teams?sportId=1&season=2027'
const nflSource =
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=2026&seasontype=2'
const venueCountries = {
  USA: 'US',
  'United States': 'US',
  Canada: 'CA',
  England: 'GB',
  Germany: 'DE',
  Brazil: 'BR',
  Australia: 'AU',
  Spain: 'ES',
  Mexico: 'MX',
  France: 'FR'
}

function regularSeason({
  competition,
  clubs,
  organizer,
  fixtures,
  id,
  gamesPerClub,
  clubCount,
  sourceUrl,
  evidence
}) {
  const ids = new Set(),
    counts = new Map([...clubs.keys()].map((key) => [key, 0]))
  for (const f of fixtures) {
    if (
      ids.has(f.id) ||
      f.participants.length !== 2 ||
      f.participants[0].organizationId === f.participants[1].organizationId
    )
      throw new Error('Invalid fixture ' + f.id)
    ids.add(f.id)
    for (const { organizationId } of f.participants) {
      if (!counts.has(organizationId)) throw new Error('Unknown club ' + organizationId)
      counts.set(organizationId, counts.get(organizationId) + 1)
    }
  }
  if (clubs.size !== clubCount || [...counts.values()].some((n) => n !== gamesPerClub))
    throw new Error('Incomplete regular season for ' + competition.name)
  fixtures.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  const batch = {
    organizations: [organizer, ...clubs.values()],
    competitions: [competition],
    fixtures,
    seasons: [
      {
        ...evidence,
        id,
        competitionId: competition.id,
        label: id.includes('2027') ? '2027 regular season' : '2026 regular season',
        startsOn: fixtures[0].date,
        endsOn: fixtures.at(-1).date,
        expectedFixtureCount: (clubCount * gamesPerClub) / 2,
        expectedFixtureIds: fixtures.map((f) => f.id),
        sourceUrl,
        markets: []
      }
    ]
  }
  for (const country of new Set(fixtures.flatMap((f) => f.broadcasts.map((b) => b.country))))
    updateMarket(batch, country, sourceUrl, evidence)
  return batch
}

export async function loadMlbSeason(fetchJson, evidence) {
  const [schedule, roster] = await Promise.all([fetchJson(mlbSource), fetchJson(mlbTeams)])
  const clubs = new Map(),
    fixtures = [],
    id = 'mlb-2027'
  const logo = {
    url: 'https://www.mlbstatic.com/team-logos/league-on-dark/1.svg',
    sourceUrl: 'https://www.mlb.com/team'
  }
  const organizer = {
    id: 'mlb-organization',
    name: 'Major League Baseball',
    country: 'US',
    kind: 'organizer',
    logo
  }
  const competition = {
    id: 'mlb',
    name: 'Major League Baseball',
    sport: 'baseball',
    kind: 'league',
    leagueCountry: 'US',
    leagueCountries: ['US', 'CA'],
    organizerId: organizer.id,
    logo
  }
  for (const t of roster.teams) {
    if (t.sport?.id !== 1 || t.season !== 2027 || !Number.isInteger(t.id) || !t.name)
      throw new Error('Invalid MLB team')
    const key = 'mlb-club-' + t.id
    clubs.set(key, {
      id: key,
      kind: 'club',
      name: t.name,
      country: t.id === 141 ? 'CA' : 'US',
      logo: {
        url: 'https://www.mlbstatic.com/team-logos/team-cap-on-light/' + t.id + '.svg',
        sourceUrl: 'https://www.mlb.com/team'
      }
    })
  }
  for (const day of schedule.dates)
    for (const g of day.games) {
      if (g.gameType !== 'R' || g.season !== '2027' || !Number.isInteger(g.gamePk) || !isDate(g.officialDate))
        throw new Error('Invalid MLB regular-season fixture')
      const state = g.status?.detailedState
      const known = g.status?.startTimeTBD === false && isTimestamp(g.gameDate)
      const startStatus = /^postponed|suspended/i.test(state)
        ? 'postponed'
        : /^cancel+ed/i.test(state)
          ? 'cancelled'
          : known && /^(?:scheduled|pre-game|warmup|in progress|final|game over|completed early)/i.test(state)
            ? 'scheduled'
            : 'unannounced'
      const country = venueCountries[g.venue?.location?.country]
      fixtures.push({
        id: 'mlb-game-' + g.gamePk,
        seasonId: id,
        title: g.teams.away.team.name + ' at ' + g.teams.home.team.name,
        date: g.officialDate,
        startsAt: startStatus === 'scheduled' ? g.gameDate : null,
        startStatus,
        sourceUrl: 'https://www.mlb.com/gameday/' + g.gamePk,
        ...(country && { venueCountry: country }),
        venueName: g.venue?.name,
        participants: ['home', 'away'].map((role) => ({
          role,
          organizationId: 'mlb-club-' + g.teams[role].team.id
        })),
        broadcasts: []
      })
    }
  if (schedule.totalGames !== fixtures.length) throw new Error('Incomplete MLB response')
  return regularSeason({
    competition,
    clubs,
    organizer,
    fixtures,
    id,
    gamesPerClub: 162,
    clubCount: 30,
    sourceUrl: mlbSource,
    evidence
  })
}

export const classicAnnouncement =
  'https://www.mlb.com/cubs/news/blue-jays-cubs-2027-mlb-little-league-classic'

export function addClassicAirings(batch, html, evidence) {
  const article = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
  if (
    !/Toronto Blue Jays and the Chicago Cubs/i.test(article) ||
    !/Thursday, August 19, 2027, will air exclusively on ESPN and in Canada on Sportsnet at 7:10 p\.m\. \(ET\)/i.test(
      article
    )
  )
    return
  const air = '2027-08-19T23:10:00Z'
  const matching = batch.fixtures.filter(
    (f) =>
      f.date === '2027-08-19' &&
      f.title === 'Chicago Cubs at Toronto Blue Jays' &&
      f.startStatus === 'scheduled' &&
      Date.parse(f.startsAt) === Date.parse(air)
  )
  if (matching.length !== 1) return
  const fixture = matching[0]
  for (const [country, name, destinationId, type] of [
    ['US', 'ESPN', 'espn-us', 'channel'],
    ['CA', 'Sportsnet', 'sportsnet-ca', 'network']
  ]) {
    fixture.broadcasts = fixture.broadcasts.filter((b) => b.destinationId !== destinationId)
    fixture.broadcasts.push({
      ...evidence,
      country,
      name,
      destinationId,
      type,
      kind: 'live',
      airsAt: air,
      sourceUrl: classicAnnouncement
    })
    updateMarket(batch, country, classicAnnouncement, evidence)
  }
}

export async function loadNflSeason(fetchJson, evidence) {
  const fixtures = [],
    clubs = new Map(),
    id = 'nfl-2026'
  let logo
  for (let start = 1; start <= 18; start += 3) {
    const urls = [start, start + 1, start + 2].map((week) => nflSource + '&week=' + week + '&limit=100')
    const pages = await Promise.all(urls.map(fetchJson))
    for (const [i, page] of pages.entries()) {
      const league = page.leagues?.find((l) => l.slug === 'nfl')
      if (!league || !page.events?.length) throw new Error('Missing NFL week ' + (i + start))
      const sourceUrl = urls[i]
      logo ??= { url: league.logos.find((l) => l.rel.includes('default')).href, sourceUrl }
      for (const g of page.events) {
        const c = g.competitions?.[0]
        if (
          g.season?.year !== 2026 ||
          g.season.type !== 2 ||
          g.week?.number !== i + start ||
          !/^\d+$/.test(g.id) ||
          c?.id !== g.id ||
          !c.date ||
          typeof c.timeValid !== 'boolean'
        )
          throw new Error('Invalid NFL week or game')
        const participants = ['home', 'away'].map((role) => {
          const t = c.competitors.find((p) => p.homeAway === role)?.team
          if (
            !/^\d+$/.test(t?.id ?? '') ||
            !t.displayName ||
            !t.logo?.startsWith('https://a.espncdn.com/i/teamlogos/')
          )
            throw new Error('Invalid NFL team')
          const key = 'nfl-club-' + t.id
          if (!clubs.has(key))
            clubs.set(key, {
              id: key,
              kind: 'club',
              country: 'US',
              name: t.displayName,
              logo: { url: t.logo, sourceUrl }
            })
          return { role, organizationId: key }
        })
        const state = c.status?.type
        const startStatus =
          state?.name === 'STATUS_POSTPONED'
            ? 'postponed'
            : state?.name === 'STATUS_CANCELED'
              ? 'cancelled'
              : c.timeValid &&
                  (state?.name === 'STATUS_SCHEDULED' || state?.state === 'in' || state?.completed === true)
                ? 'scheduled'
                : 'unannounced'
        const time = new Date(c.date)
        const broadcasts = new Map()
        for (const b of c.geoBroadcasts ?? []) {
          const country = b.region?.toUpperCase(),
            name = b.media?.shortName,
            type = b.type?.shortName?.toLowerCase()
          if (
            !name ||
            !isSupportedTerritory(country) ||
            b.market?.type !== 'National' ||
            !['tv', 'streaming'].includes(type) ||
            ['postponed', 'cancelled'].includes(startStatus)
          )
            continue
          const destinationId =
            'nfl-' + country.toLowerCase() + '-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
          broadcasts.set(destinationId, {
            ...evidence,
            country,
            name,
            destinationId,
            type: type === 'tv' ? 'channel' : 'service',
            kind: 'unspecified',
            airsAt: null,
            sourceUrl,
            ...(type === 'tv' && { availabilityNote: 'Check local station listings for availability.' })
          })
        }
        // The NFL groups overnight UTC starts under the US Eastern schedule date.
        const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York' }).format(time)
        const venueCountry = venueCountries[c.venue?.address?.country]
        fixtures.push({
          id: 'nfl-game-' + g.id,
          seasonId: id,
          title: g.name,
          date,
          startsAt: startStatus === 'scheduled' ? time.toISOString() : null,
          startStatus,
          sourceUrl: g.links?.find((l) => l.rel.includes('summary'))?.href ?? sourceUrl,
          participants,
          broadcasts: [...broadcasts.values()],
          ...(venueCountry && { venueCountry }),
          venueName: c.venue?.fullName
        })
      }
    }
  }
  const organizer = {
    id: 'nfl-organization',
    name: 'National Football League',
    kind: 'organizer',
    country: 'US',
    logo
  }
  const competition = {
    id: 'nfl',
    name: 'National Football League',
    sport: 'american-football',
    kind: 'league',
    leagueCountry: 'US',
    organizerId: organizer.id,
    logo
  }
  return regularSeason({
    competition,
    clubs,
    organizer,
    fixtures,
    id,
    gamesPerClub: 17,
    clubCount: 32,
    sourceUrl: nflSource + '&week=1',
    evidence
  })
}
