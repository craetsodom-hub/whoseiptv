import { isDate, isTimestamp } from './model.mjs'
import { isSupportedTerritory } from '../territories.mjs'

export const domesticLeagues = [
  {
    id: 'mls',
    slug: 'usa.1',
    name: 'Major League Soccer',
    teams: 30,
    country: 'US',
    organizer: 'Major League Soccer',
    site: 'https://www.espn.com/soccer/league/_/name/usa.1',
    badge: 'https://a.espncdn.com/i/leaguelogos/soccer/500/19.png'
  },
  {
    id: 'laliga',
    slug: 'esp.1',
    country: 'ES',
    name: 'LaLiga',
    teams: 20,
    organizer: 'LALIGA',
    site: 'https://www.laliga.com/en-GB',
    badge: 'https://assets.laliga.com/assets/public/logos/LaLiga_Logo_Ver.png'
  },
  {
    id: 'bundesliga',
    slug: 'ger.1',
    country: 'DE',
    name: 'Bundesliga',
    teams: 18,
    organizer: 'Bundesliga Group',
    site: 'https://www.bundesliga-gruppe.de/en/',
    badge:
      'https://www.bundesliga-gruppe.de/wp-content/themes/dfl-theme/assets/logos/bl_group_logo_hor_RGB_pos.png'
  },
  {
    id: 'serie-a',
    slug: 'ita.1',
    country: 'IT',
    name: 'Serie A',
    teams: 20,
    organizer: 'Lega Calcio Serie A',
    site: 'https://www.legaseriea.it/it',
    badge: 'https://www.legaseriea.it/apple-icon.png'
  },
  {
    id: 'ligue-1',
    slug: 'fra.1',
    country: 'FR',
    name: 'Ligue 1',
    teams: 18,
    organizer: 'Ligue de Football Professionnel',
    site: 'https://www.lfp.fr/',
    badge: 'https://www.lfp.fr/assets/LFP_e5d2655ef3.jpg'
  }
]

const months = [
  '202607',
  '202608',
  '202609',
  '202610',
  '202611',
  '202612',
  '202701',
  '202702',
  '202703',
  '202704',
  '202705',
  '202706'
]
const scoreUrl = (league, month) =>
  'https://site.api.espn.com/apis/site/v2/sports/soccer/' +
  league.slug +
  '/scoreboard?dates=' +
  month +
  '&limit=300'
const seasonId = (league) => (league.id === 'mls' ? 'mls-2026' : league.id + '-2026-27')
const asset = (url, sourceUrl) => ({ url, sourceUrl })

export function updateMarket(batch, country, sourceUrl, evidence) {
  const season = batch.seasons[0]
  const markets = season.markets.filter((row) => row.country !== country)
  const expectedListedFixtureIds = batch.fixtures
    .filter((f) => f.broadcasts.some((b) => b.country === country))
    .map((f) => f.id)
  if (expectedListedFixtureIds.length)
    markets.push({ ...evidence, country, sourceUrl, expectedListedFixtureIds })
  season.markets = markets
}

export async function loadDomesticLeague(league, fetchJson, evidence) {
  const organizerId = league.id + '-organization'
  const organizer = {
    id: organizerId,
    name: league.organizer,
    kind: 'organizer',
    country: league.country,
    logo: asset(league.badge, league.site)
  }
  const clubs = new Map()
  const fixtures = []
  const matchups = new Set()
  const markets = new Set()
  let logo
  const mls = league.id === 'mls'
  const scheduleMonths = mls
    ? Array.from({ length: 12 }, (_, i) => '2026' + String(i + 1).padStart(2, '0'))
    : months
  const regularCounts = new Map()
  const seriesGames = new Map()
  let completedFinal = false
  const localDate = new Intl.DateTimeFormat('sv-SE', { timeZone: mls ? 'America/New_York' : 'Europe/Paris' })
  for (let i = 0; i < scheduleMonths.length; i += 3) {
    const group = scheduleMonths.slice(i, i + 3)
    const pages = await Promise.all(group.map((month) => fetchJson(scoreUrl(league, month))))
    for (const [j, page] of pages.entries()) {
      const url = scoreUrl(league, group[j])
      const meta = page.leagues?.find((l) => l.slug === league.slug)
      if (!meta || !Array.isArray(page.events) || page.events.length >= 300)
        throw new Error('Invalid monthly scoreboard ' + url)
      const badge = meta.logos?.find((l) => l.rel?.includes('default'))?.href
      if (!logo && badge) logo = asset(badge, url)
      for (const event of page.events) {
        if (event.season?.year !== 2026 || (!mls && !event.season.slug.startsWith('2026-27-'))) continue
        const stage = event.season.slug
        // The source groups the inter-league All-Star exhibition with the regular season.
        if (mls && event.id === '401864004') continue
        const game = event.competitions?.[0]
        const sourceUrl = event.links?.find((link) => link.rel?.includes('summary'))?.href ?? url
        if (
          !/^\d+$/.test(event.id) ||
          game?.id !== event.id ||
          game.competitors?.length !== 2 ||
          typeof game.timeValid !== 'boolean' ||
          !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?Z$/.test(game.date)
        ) {
          throw new Error('Invalid match ' + event.id)
        }
        const participants = ['home', 'away'].map((role) => {
          const team = game.competitors.find((c) => c.homeAway === role)?.team
          if (
            !/^\d+$/.test(team?.id ?? '') ||
            !team.displayName ||
            !team.logo?.startsWith('https://a.espncdn.com/i/teamlogos/')
          )
            throw new Error('Invalid club on ' + event.id)
          const id = 'football-espn-' + team.id
          if (!clubs.has(id))
            clubs.set(id, {
              id,
              name: team.displayName,
              kind: 'club',
              country:
                team.id === '174'
                  ? 'MC'
                  : mls && ['9727', '7318', '9720'].includes(team.id)
                    ? 'CA'
                    : league.country,
              logo: asset(team.logo, team.links?.find((l) => l.rel?.includes('clubhouse'))?.href ?? url)
            })
          return { role, organizationId: id }
        })
        const pair = participants.map((p) => p.organizationId).join('/')
        if ((!mls && matchups.has(pair)) || participants[0].organizationId === participants[1].organizationId)
          throw new Error('Duplicate domestic league matchup ' + pair)
        matchups.add(pair)
        if (mls && stage === 'regular-season')
          for (const p of participants) {
            regularCounts.set(p.organizationId, (regularCounts.get(p.organizationId) ?? 0) + 1)
          }
        if (mls && ['mls-cup', 'mls-cup-final'].includes(stage) && game.status?.type?.completed)
          completedFinal = true
        const status = game.status?.type?.name
        const confirmed =
          game.timeValid &&
          [
            'STATUS_SCHEDULED',
            'STATUS_FULL_TIME',
            'STATUS_FINAL',
            'STATUS_FINAL_PEN',
            'STATUS_FINAL_AET',
            'STATUS_FIRST_HALF',
            'STATUS_SECOND_HALF',
            'STATUS_HALFTIME',
            'STATUS_IN_PROGRESS'
          ].includes(status)
        const startStatus =
          status === 'STATUS_POSTPONED'
            ? 'postponed'
            : status === 'STATUS_CANCELED'
              ? 'cancelled'
              : confirmed
                ? 'scheduled'
                : 'unannounced'
        const startsAt = confirmed ? new Date(game.date).toISOString() : null
        const broadcasts = new Map()
        for (const row of game.geoBroadcasts ?? []) {
          const country = row.region?.toUpperCase()
          const name = row.media?.shortName
          if (
            row.market?.type !== 'National' ||
            !isSupportedTerritory(country) ||
            !name ||
            !['TV', 'STREAMING'].includes(row.type?.shortName) ||
            ['cancelled', 'postponed'].includes(startStatus)
          )
            continue
          const destinationId =
            'tv-' +
            country.toLowerCase() +
            '-' +
            name
              .toLowerCase()
              .replace(/\+/g, '-plus')
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/-$/, '')
          const type = row.type.shortName === 'STREAMING' ? 'service' : 'channel'
          broadcasts.set(destinationId, {
            ...evidence,
            country,
            destinationId,
            name,
            type,
            kind: 'unspecified',
            airsAt: null,
            sourceUrl: url
          })
          markets.add(country)
        }
        fixtures.push({
          id: 'football-espn-' + event.id,
          seasonId: seasonId(league),
          title: event.name,
          ...(mls && { stage }),
          date: localDate.format(new Date(game.date)),
          startsAt,
          startStatus,
          sourceUrl,
          participants,
          broadcasts: [...broadcasts.values()]
        })
        if (mls && stage !== 'regular-season' && game.series?.totalCompetitions === 3) {
          const key = [stage, ...participants.map((p) => p.organizationId).sort()].join('/')
          const entries = seriesGames.get(key) ?? []
          const winner = game.competitors.find((t) => t.winner)?.team?.id
          entries.push({ fixture: fixtures.at(-1), winner: game.status.type.completed ? winner : null })
          seriesGames.set(key, entries)
        }
      }
    }
  }
  // A best-of-three decider only becomes certain after each team has won once.
  for (const entries of seriesGames.values()) {
    entries.sort((a, b) => a.fixture.date.localeCompare(b.fixture.date))
    const third = entries[2]?.fixture
    if (
      third?.startStatus === 'scheduled' &&
      !entries[2].winner &&
      new Set(
        entries
          .slice(0, 2)
          .map((e) => e.winner)
          .filter(Boolean)
      ).size !== 2
    ) {
      third.startStatus = 'provisional'
    }
  }
  const expectedFixtureCount = mls ? 510 : league.teams * (league.teams - 1)
  if (
    !logo ||
    clubs.size !== league.teams ||
    (mls
      ? regularCounts.size !== 30 || [...regularCounts.values()].some((n) => n !== 34)
      : fixtures.length !== expectedFixtureCount)
  )
    throw new Error('Incomplete ' + league.name + ' round-robin inventory')
  fixtures.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  const sourceUrl = 'https://www.espn.com/soccer/fixtures/_/league/' + league.slug
  const batch = {
    organizations: [organizer, ...clubs.values()],
    competitions: [
      {
        id: league.id,
        name: league.name,
        sport: 'football',
        kind: 'league',
        leagueCountry: league.country,
        ...(mls && { leagueCountries: ['US', 'CA'] }),
        organizerId,
        logo
      }
    ],
    fixtures,
    seasons: [
      {
        ...evidence,
        id: seasonId(league),
        competitionId: league.id,
        label: mls ? '2026 regular season and MLS Cup Playoffs' : '2026/27 regular season',
        sourceUrl,
        startsOn: fixtures[0].date,
        endsOn: fixtures.at(-1).date,
        ...(mls ? !completedFinal && { fixtureInventoryStatus: 'partial' } : { expectedFixtureCount }),
        expectedFixtureIds: fixtures.map((f) => f.id),
        markets: []
      }
    ]
  }
  for (const country of markets) updateMarket(batch, country, sourceUrl, evidence)
  return batch
}

export const europeanCups = [
  { id: 'uefa-champions-league', number: 1, qualifiers: 90, leagueGames: 144 },
  { id: 'uefa-europa-league', number: 14, qualifiers: 80, leagueGames: 144 },
  { id: 'uefa-conference-league', number: 2019, qualifiers: 258, leagueGames: 108 }
]

const associations = Object.fromEntries(
  'ALB:AL AND:AD ARM:AM AUT:AT AZE:AZ BEL:BE BIH:BA BLR:BY BUL:BG CRO:HR CYP:CY CZE:CZ DEN:DK ENG:GB ESP:ES EST:EE FIN:FI FRA:FR FRO:FO GEO:GE GER:DE GIB:GI GRE:GR HUN:HU IRL:IE ISL:IS ISR:IL ITA:IT KAZ:KZ KOS:XK LIE:LI LTU:LT LUX:LU LVA:LV MDA:MD MKD:MK MLT:MT MNE:ME NED:NL NIR:GB NOR:NO POL:PL POR:PT ROU:RO SCO:GB SMR:SM SRB:RS SUI:CH SVK:SK SVN:SI SWE:SE TUR:TR UKR:UA WAL:GB MCO:MC RUS:RU'
    .split(' ')
    .map((p) => p.split(':'))
)

export async function loadEuropeanCup(cup, fetchJson, evidence) {
  const source = 'https://match.uefa.com/v5/matches?competitionId=' + cup.number + '&seasonYear=2027'
  const fixtures = [],
    clubs = new Map(),
    ids = new Set()
  let competition,
    qualifiers = 0,
    leagueGames = 0
  const organizer = {
    id: 'uefa',
    name: 'UEFA',
    kind: 'federation',
    country: 'CH',
    logo: asset(
      'https://img.uefa.com/imgml/uefacom/elements/main-nav/uefa-logo-black.svg',
      'https://www.uefa.com/'
    )
  }
  for (let offset = 0; ; offset += 100) {
    const page = await fetchJson(source + '&limit=100&offset=' + offset)
    if (!Array.isArray(page) || page.length > 100) throw new Error('Invalid UEFA schedule page')
    for (const game of page) {
      if (
        game.seasonYear !== '2027' ||
        game.competition?.id !== String(cup.number) ||
        !/^\d+$/.test(game.id) ||
        ids.has(game.id)
      )
        throw new Error('Wrong edition or overlapping UEFA pages')
      ids.add(game.id)
      competition ??= {
        id: cup.id,
        name: game.competition.metaData.name,
        kind: 'cup',
        sport: 'football',
        leagueCountry: null,
        organizerId: organizer.id,
        logo: asset(game.competition.images.FULL_LOGO, source + '&limit=1')
      }
      const participants = []
      for (const role of ['home', 'away']) {
        const team = game[role + 'Team']
        if (!team?.id || !team.countryCode || team.teamType === 'PLACEHOLDER') continue
        const country = associations[team.countryCode]
        const id = 'football-uefa-' + team.id
        if (!country || !team.internationalName || !team.bigLogoUrl?.startsWith('https://img.uefa.com/'))
          throw new Error('Unverified UEFA club ' + team.id)
        // The association code is the sporting affiliation. Monaco is based in MC.
        clubs.set(id, {
          id,
          name: team.internationalName,
          country: team.id === '50023' && /monaco/i.test(team.internationalName) ? 'MC' : country,
          kind: 'club',
          logo: asset(
            team.id === '59869' ? team.logoUrl : team.bigLogoUrl,
            'https://www.uefa.com/nationalassociations/teams/' + team.id + '--/'
          )
        })
        participants.push({ role, organizationId: id })
      }
      const ko = game.kickOffTime
      if (!isDate(ko?.date)) throw new Error('UEFA fixture without a dated schedule ' + game.id)
      const startStatus =
        game.status === 'POSTPONED'
          ? 'postponed'
          : game.status === 'CANCELLED'
            ? 'cancelled'
            : ['UPCOMING', 'LIVE', 'PLAYING', 'FINISHED'].includes(game.status) && isTimestamp(ko.dateTime)
              ? 'scheduled'
              : 'unannounced'
      const stage = game.round?.phase
      if (stage === 'QUALIFYING') qualifiers++
      if (stage === 'TOURNAMENT' && game.type === 'GROUP_STAGE') leagueGames++
      fixtures.push({
        id: 'uefa-match-' + game.id,
        seasonId: seasonId(cup),
        title: [game.homeTeam, game.awayTeam].map((t) => t?.internationalName || 'TBD').join(' v '),
        stage: game.round?.metaData?.name,
        phase: stage,
        date: ko.date,
        startStatus,
        startsAt: startStatus === 'scheduled' ? ko.dateTime : null,
        sourceUrl: 'https://www.uefa.com/' + cup.id.replaceAll('-', '') + '/match/' + game.id + '/',
        participants,
        broadcasts: [],
        ...(associations[game.stadium?.countryCode] && {
          venueCountry: associations[game.stadium.countryCode]
        })
      })
    }
    if (page.length < 100) break
  }
  if (qualifiers !== cup.qualifiers || leagueGames !== cup.leagueGames)
    throw new Error('Incomplete UEFA qualifying or league-phase inventory')
  fixtures.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  return {
    competitions: [competition],
    organizations: [organizer, ...clubs.values()],
    fixtures,
    seasons: [
      {
        ...evidence,
        id: seasonId(cup),
        competitionId: cup.id,
        label: '2026/27',
        sourceUrl: source + '&limit=100',
        startsOn: fixtures[0].date,
        endsOn: '2027-06-30',
        expectedFixtureCount: cup.qualifiers + cup.leagueGames + 45,
        expectedFixtureIds: fixtures.map((f) => f.id),
        markets: []
      }
    ]
  }
}
