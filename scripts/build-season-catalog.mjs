import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { isDeepStrictEqual, promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { parseSkyFixtureSchedule, SKY_PREMIER_LEAGUE_URL } from './broadcast/sky-fixtures.mjs'
import { indexCatalog } from './catalog/model.mjs'
import {
  ashes, australianOpen, nba, nbaPrimeOffers, parseAshes, parseAustralianOpen, parseNbaSeason, parseSixNations, sixNations
} from './catalog/season-expansion.mjs'
import {
  addFormulaOneUkListings, addFormulaOneUsListings, addPremierLeagueTelevision, applyLivePremierLeagueTimes,
  applyCompletedPremierLeagueResults, applyPremierLeagueAmendments, applyPremierLeagueFinalDay, formulaOne, formulaOneRaceUrls, parseFormulaOneSeason, parseFormulaOneUsPrices, parsePremierLeague, parseSportsPrices,
  premierLeague, premierLeagueConflicts, resolvePremierLeagueConflict, sportsEntitlementsUrl, sportsPricingUrl
} from './catalog/sources.mjs'

import { loadNhlSeason, nhlPrimeOffers, nhlPrimePricing, nhlPrimeRights } from './catalog/nhl.mjs'

const exec = promisify(execFile)
const MAX_BYTES = 8 * 1024 * 1024
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const timesOnly = process.env.CATALOG_TIMES_ONLY === '1'

async function fetchText(url, maxBytes = MAX_BYTES, headers = {}) {
  let response
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) })
  } catch {
    const requestHeaders = Object.entries(headers).flatMap(([name, value]) => ['--header', `${name}: ${value}`])
    const { stdout } = await exec('curl', ['--fail', '--location', '--silent', '--show-error', '--compressed',
      '--max-time', '30', '--max-filesize', String(maxBytes), ...requestHeaders, url], { maxBuffer: maxBytes })
    if (!stdout) throw new Error(`Empty response from ${url}`)
    return stdout
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`)
  const chunks = []
  let bytes = 0
  for await (const chunk of response.body ?? []) {
    bytes += chunk.byteLength
    if (bytes > maxBytes) throw new Error(`Response too large from ${url}`)
    chunks.push(chunk)
  }
  if (bytes === 0) throw new Error(`Empty response from ${url}`)
  return Buffer.concat(chunks).toString('utf8')
}

const json = async url => JSON.parse(await fetchText(url))

function verificationTimes() {
  const time = Date.now()
  return { verifiedAt: new Date(time).toISOString(), validUntil: new Date(time + ONE_DAY_MS).toISOString() }
}

async function loadPremierLeague() {
  const [html, roster] = await Promise.all([fetchText(premierLeague.fixtures), json(premierLeague.roster)])
  const batch = parsePremierLeague(html, roster, verificationTimes())
  const conflicts = premierLeagueConflicts(batch.fixtures)
  const months = new Set(conflicts.flat().map(fixture => fixture.date.slice(0, 7).replace('-', '')))
  const scoreboards = new Map()
  for (const month of months) {
    const scoreboard = await json(`${premierLeague.scoreboard}?dates=${month}&limit=300`)
    if (!scoreboard.leagues?.some(league => league.slug === 'eng.1')) throw new Error('Unexpected fixture cross-check response')
    scoreboards.set(month, scoreboard)
  }
  const logoMonth = '202608'
  const logoUrl = `${premierLeague.scoreboard}?dates=${logoMonth}&limit=300`
  const logoPage = scoreboards.get(logoMonth) ?? await json(logoUrl)
  const logo = logoPage.leagues?.find(league => league.slug === 'eng.1')?.logos
    ?.find(asset => asset.rel?.includes('default'))?.href
  if (!/^https:\/\/a\.espncdn\.com\/i\/leaguelogos\//.test(logo ?? '')) {
    throw new Error('Missing verified competition logo')
  }
  batch.competitions[0].logo = { url: logo, sourceUrl: logoUrl }
  batch.organizations[0].logo = batch.competitions[0].logo
  const resolved = new Map(conflicts.map(rows => [rows[0].id, resolvePremierLeagueConflict(rows, scoreboards)]))
  batch.fixtures = [...new Map(batch.fixtures.map(row => [row.id, resolved.get(row.id) ?? row])).values()]
  try {
    const updates = await fetchText(premierLeague.januaryAmendments)
    const amended = parsePremierLeague(updates, roster, verificationTimes(), premierLeague.januaryAmendments)
    if (amended.fixtures.length !== 30) throw new Error('Incomplete published matchweek amendment')
    applyPremierLeagueAmendments(batch, amended.fixtures)
  } catch (error) {
    console.error(`January fixture amendments could not be applied. ${error.message}`)
  }
  try {
    applyPremierLeagueFinalDay(batch, await fetchText(premierLeague.seasonAnnouncement))
  } catch (error) {
    console.error(`Final-day kickoff could not be verified. ${error.message}`)
  }
  const playedMonths = new Set(batch.fixtures
    .filter(row => row.startStatus !== 'scheduled' && Date.parse(row.date) < Date.now())
    .map(row => row.date.slice(0, 7).replace('-', '')))
  if (!scoreboards.has(logoMonth)) scoreboards.set(logoMonth, logoPage)
  for (const month of playedMonths) {
    if (scoreboards.has(month)) continue
    try {
      scoreboards.set(month, await json(`${premierLeague.scoreboard}?dates=${month}&limit=300`))
    } catch (error) {
      console.error(`Historical kickoff verification skipped for ${month}. ${error.message}`)
    }
  }
  applyCompletedPremierLeagueResults(batch, scoreboards)
  batch.seasons[0].timeSyncUnavailable = true
  try {
    const listings = await optionalPage(SKY_PREMIER_LEAGUE_URL)
    const [games, teams] = await Promise.allSettled([json(premierLeague.liveFixtures), json(premierLeague.liveTeams)])
    if (games.status === 'fulfilled' && teams.status === 'fulfilled') {
      const evidence = verificationTimes()
      applyLivePremierLeagueTimes(batch, games.value, teams.value, parseSkyFixtureSchedule(listings, {}, new Date(evidence.verifiedAt)), evidence)
      delete batch.seasons[0].timeSyncUnavailable
    } else {
      console.error('Live Premier League schedule unavailable. Existing time confirmations retain their original expiry.')
    }
    addPremierLeagueTelevision(batch, listings, verificationTimes())
  } catch (error) {
    console.error(`Channel airtimes are unavailable for this refresh. ${error.message}`)
  }
  batch.seasons[0].markets[0].expectedListedFixtureIds = batch.fixtures
    .filter(fixture => fixture.broadcasts.length).map(fixture => fixture.id)
  return batch
}

async function loadFormulaOne() {
  const [calendar, broadcasters] = await Promise.all([fetchText(formulaOne.calendar),
    timesOnly ? '' : fetchText(formulaOne.broadcasters)])
  const urls = formulaOneRaceUrls(calendar)
  const pages = new Map()
  for (let offset = 0; offset < urls.length; offset += 4) {
    const group = await Promise.all(urls.slice(offset, offset + 4).map(async url => [url, await fetchText(url)]))
    for (const [url, html] of group) pages.set(url, html)
  }
  const season = parseFormulaOneSeason(calendar, pages, broadcasters, verificationTimes())
  if (timesOnly) return season
  const schedules = await Promise.allSettled([formulaOne.ukListings, formulaOne.ukFinaleListings]
    .map(async url => [url, await fetchText(url)]))
  addFormulaOneUkListings(season, schedules.filter(result => result.status === 'fulfilled').map(result => result.value),
    verificationTimes())
  for (const result of schedules) {
    if (result.status === 'rejected') console.error(`Racing TV listings could not be verified. ${result.reason.message}`)
  }
  try {
    addFormulaOneUsListings(season, await fetchText(formulaOne.usListings, 32 * 1024 * 1024), verificationTimes())
  } catch (error) {
    console.error(`US racing TV listings could not be verified. ${error.message}`)
  }
  return season
}

async function optionalPage(url) {
  try {
    return await fetchText(url)
  } catch (error) {
    console.error(`Supplemental data unavailable for ${url}. ${error.message}`)
    return ''
  }
}

async function loadAdditionalSeasons() {
  const sources = [
    ['NHL', async () => {
      const [batch, pricing, rights] = await Promise.all([loadNhlSeason(json, verificationTimes()),
        timesOnly ? '' : optionalPage(nhlPrimePricing), timesOnly ? '' : optionalPage(nhlPrimeRights)])
      batch.offers = nhlPrimeOffers(batch.fixtures, pricing, rights, verificationTimes())
      return [batch]
    }],
    ['NBA', async () => {
      const [schedule, announcement, pricing] = await Promise.all([
        fetchText(nba.schedule, MAX_BYTES, { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.nba.com/' }),
        fetchText(nba.announcement), timesOnly ? '' : optionalPage(nba.primePricing)
      ])
      const batch = parseNbaSeason(JSON.parse(schedule), announcement, verificationTimes())
      batch.offers = nbaPrimeOffers(batch, pricing, verificationTimes())
      return [batch]
    }],
    ...Object.values(sixNations).map(edition => [edition.name, async () => {
      const [fixtures, rights] = await Promise.all([fetchText(edition.fixtures), optionalPage(edition.rights)])
      return [parseSixNations(edition, fixtures, rights, verificationTimes())]
    }]),
    ['The Ashes', async () => {
      const [fixtures, broadcasts, organizer] = await Promise.all([
        fetchText(ashes.fixtures), optionalPage(ashes.broadcasts), optionalPage(ashes.australia)
      ])
      return parseAshes(fixtures, broadcasts, organizer, verificationTimes())
    }],
    ['Australian Open', async () => {
      const [dates, organizer, rights] = await Promise.all([
        fetchText(australianOpen.dates), fetchText(australianOpen.organizer), optionalPage(australianOpen.rights)
      ])
      return [parseAustralianOpen(dates, organizer, rights, verificationTimes())]
    }]
  ]
  const results = await Promise.allSettled(sources.map(([, load]) => load()))
  return results.flatMap((result, index) => {
    if (result.status === 'fulfilled') return result.value
    console.error(`${sources[index][0]} coverage unavailable for this refresh. ${result.reason.message}`)
    return []
  })
}

async function writeSnapshot(catalogPath, catalog) {
  await mkdir(dirname(catalogPath), { recursive: true })
  const temporary = `${catalogPath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`, { flag: 'wx' })
    await rename(temporary, catalogPath)
  } finally {
    await rm(temporary, { force: true })
  }
}

const [output = '.season-catalog/catalog.json', ...inputPaths] = process.argv.slice(2)
async function loadSeason(load) {
  try {
    return await load()
  } catch (error) {
    if (!timesOnly) throw error
    console.error(`Time sync could not refresh ${load.name}: ${error.message}`)
    return null
  }
}
const [football, racing, expanded, ...additional] = await Promise.all([
  loadSeason(loadPremierLeague), loadSeason(loadFormulaOne), loadAdditionalSeasons(),
  ...inputPaths.map(async path => JSON.parse(await readFile(path, 'utf8')))
])
let offers = []
try {
  const [pricing, entitlements] = await Promise.all([
    fetchText(sportsPricingUrl),
    fetchText(sportsEntitlementsUrl).catch(error => {
      console.error(`Additional viewing plan entitlements could not be verified. ${error.message}`)
      return ''
    })
  ])
  offers = parseSportsPrices(pricing, verificationTimes(), entitlements)
} catch (error) {
  console.error(`The current subscription price check failed. ${error.message}`)
  try {
    const previous = indexCatalog(JSON.parse(await readFile(process.env.CATALOG_PREVIOUS_PATH ?? output, 'utf8')))
    offers = [...previous.offers.values()].filter(offer =>
      offer.sourceUrl === sportsPricingUrl && Date.parse(offer.validUntil) > Date.now())
  } catch {
    // An earlier snapshot is optional. Expired prices are never renewed here.
  }
}
if (racing?.seasons[0].markets.some(market => market.country === 'US' && market.expectedListedFixtureIds.length)) {
  try {
    const [pricing, entitlements] = await Promise.all([
      fetchText(formulaOne.usPricing), fetchText(formulaOne.usEntitlements)
    ])
    offers.push(...parseFormulaOneUsPrices(pricing, entitlements, verificationTimes(), racing.fixtures))
  } catch (error) {
    console.error(`US racing subscription pricing could not be verified. ${error.message}`)
  }
}
const batches = [football, racing, ...expanded, ...additional].filter(Boolean)
if (!football || !racing) offers = []

function combineEntities(rows) {
  const entities = new Map()
  for (const row of rows) {
    if (entities.has(row.id) && !isDeepStrictEqual(entities.get(row.id), row)) {
      throw new Error(`Conflicting entity data for ${row.id}`)
    }
    entities.set(row.id, row)
  }
  return [...entities.values()]
}
const catalog = {
  schemaVersion: 1, generatedAt: new Date().toISOString(),
  competitions: combineEntities(batches.flatMap(batch => batch.competitions)),
  organizations: combineEntities(batches.flatMap(batch => batch.organizations)),
  seasons: batches.flatMap(batch => batch.seasons),
  fixtures: batches.flatMap(batch => batch.fixtures),
  competitionInventory: additional.flatMap(batch => batch.competitionInventory ?? []),
  offers: [...offers, ...batches.flatMap(batch => batch.offers ?? [])]
}
const { fixtures, seasons } = indexCatalog(catalog)
await writeSnapshot(resolve(output), catalog)
console.log(`Published ${fixtures.size} fixture and session records across ${seasons.size} seasons, with ${catalog.offers.length} verified price records.`)
