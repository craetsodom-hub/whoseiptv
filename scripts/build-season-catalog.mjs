import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { isDeepStrictEqual, promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { SKY_PREMIER_LEAGUE_URL } from './broadcast/sky-fixtures.mjs'
import { indexCatalog } from './catalog/model.mjs'
import {
  addPremierLeagueTelevision, formulaOne, formulaOneRaceUrls, parseFormulaOneSeason, parsePremierLeague, parseSportsPrices,
  premierLeague, premierLeagueConflicts, resolvePremierLeagueConflict, sportsPricingUrl
} from './catalog/sources.mjs'

const exec = promisify(execFile)
const MAX_BYTES = 8 * 1024 * 1024
const ONE_DAY_MS = 24 * 60 * 60 * 1000

async function fetchText(url) {
  let response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  } catch {
    const { stdout } = await exec('curl', ['--fail', '--location', '--silent', '--show-error', '--compressed',
      '--max-time', '30', '--max-filesize', String(MAX_BYTES), url], { maxBuffer: MAX_BYTES })
    if (!stdout) throw new Error(`Empty response from ${url}`)
    return stdout
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`)
  const data = await response.text()
  if (!data || Buffer.byteLength(data) > MAX_BYTES) throw new Error(`Invalid response size from ${url}`)
  return data
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
    const listings = await fetchText(SKY_PREMIER_LEAGUE_URL)
    addPremierLeagueTelevision(batch, listings, verificationTimes())
  } catch (error) {
    console.error(`Channel airtimes are unavailable for this refresh. ${error.message}`)
  }
  batch.seasons[0].markets[0].expectedListedFixtureIds = batch.fixtures
    .filter(fixture => fixture.broadcasts.length).map(fixture => fixture.id)
  return batch
}

async function loadFormulaOne() {
  const [calendar, broadcasters] = await Promise.all([fetchText(formulaOne.calendar), fetchText(formulaOne.broadcasters)])
  const urls = formulaOneRaceUrls(calendar)
  const pages = new Map()
  for (let offset = 0; offset < urls.length; offset += 4) {
    const group = await Promise.all(urls.slice(offset, offset + 4).map(async url => [url, await fetchText(url)]))
    for (const [url, html] of group) pages.set(url, html)
  }
  return parseFormulaOneSeason(calendar, pages, broadcasters, verificationTimes())
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
const [football, racing, ...additional] = await Promise.all([
  loadPremierLeague(), loadFormulaOne(),
  ...inputPaths.map(async path => JSON.parse(await readFile(path, 'utf8')))
])
let offers = []
try {
  offers = parseSportsPrices(await fetchText(sportsPricingUrl), verificationTimes())
} catch (error) {
  console.error(`The current subscription price check failed. ${error.message}`)
  try {
    const previous = indexCatalog(JSON.parse(await readFile(output, 'utf8')))
    offers = [...previous.offers.values()].filter(offer =>
      offer.sourceUrl === sportsPricingUrl && Date.parse(offer.validUntil) > Date.now())
  } catch {
    // An earlier snapshot is optional. Expired prices are never renewed here.
  }
}
const batches = [football, racing, ...additional]

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
  offers: [...offers, ...additional.flatMap(batch => batch.offers ?? [])]
}
const { fixtures, seasons } = indexCatalog(catalog)
await writeSnapshot(resolve(output), catalog)
console.log(`Published ${fixtures.size} fixture and session records across ${seasons.size} seasons, with ${catalog.offers.length} verified price records.`)
