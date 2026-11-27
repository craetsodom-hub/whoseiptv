import { pathToFileURL } from 'node:url'
import { isDate, isId, isTimestamp } from './catalog/model.mjs'
import { isSupportedTerritory } from './territories.mjs'

function required(env, name) {
  const value = env[name]?.trim()
  if (!value) throw new Error(`Set ${name}`)
  return value
}

function originUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('CATALOG_PUBLIC_URL must be the HTTPS origin of the hosted API')
  }
  return url.origin
}

async function expectJson(request, label, url, options, timeoutMs = 15_000) {
  const response = await request(url, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(timeoutMs)
  })
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`)
  return { data: await response.json(), headers: response.headers }
}

function fixtureSignature(fixture, id, country) {
  if (fixture?.id !== id || fixture.country !== country || fixture.scheduleStatus !== 'current' ||
      fixture.startStatus !== 'scheduled' || !isDate(fixture.date) || !isTimestamp(fixture.startsAt) ||
      !isId(fixture.seasonId) || !isId(fixture.competitionId) || fixture.broadcastStatus !== 'listed' ||
      !Array.isArray(fixture.participants) ||
      !Array.isArray(fixture.broadcasts) || fixture.broadcasts.length === 0) {
    throw new Error(`Selected fixture ${id} has no complete current listing in ${country}`)
  }
  const competition = fixture.competition
  if (competition?.id !== fixture.competitionId || !competition.logo?.url?.startsWith('https://') ||
      !isId(competition.organizer?.id) || !competition.organizer.logo?.url?.startsWith('https://')) {
    throw new Error(`Selected fixture ${id} contains an incomplete competition or organizer logo`)
  }
  const participants = fixture.participants.map(({ role, organization }) => {
    if (!role || !isId(organization?.id) || !organization.logo?.url?.startsWith('https://')) {
      throw new Error(`Selected fixture ${id} contains a participant without a logo`)
    }
    return JSON.stringify([role, organization.id, organization.name, organization.logo.url])
  }).sort()
  const airings = fixture.broadcasts.map(row => {
    if (row.country !== country || !['channel', 'service'].includes(row.type) ||
        !isId(row.destinationId) || !row.name || row.airtimeStatus !== 'published' ||
        !isTimestamp(row.airsAt) || row.priceStatus !== 'verified' ||
        !Array.isArray(row.offers) || !row.offers.length) {
      throw new Error(`Selected fixture ${id} contains an incomplete airing`)
    }
    const prices = row.offers.map(offer => {
      if (offer.country !== country || !Number.isSafeInteger(offer.amountMinor) ||
          offer.amountMinor < 0 || !offer.currency || !offer.billingPeriod) {
        throw new Error(`Selected fixture ${id} contains an invalid local price`)
      }
      return JSON.stringify([offer.id, offer.plan, offer.currency, offer.amountMinor, offer.billingPeriod])
    }).sort()
    return JSON.stringify([row.destinationId, row.name, row.type, row.kind, row.airsAt, prices])
  }).sort()
  return JSON.stringify([
    fixture.id, country, fixture.seasonId, fixture.competitionId, fixture.date, fixture.startsAt,
    competition.name, competition.logo.url, competition.organizer.id, competition.organizer.name,
    competition.organizer.logo.url, participants, airings
  ])
}

export async function verifyMarketplaceLaunch(env, request = fetch, { originOnly = false } = {}) {
  const origin = originUrl(required(env, 'CATALOG_PUBLIC_URL'))
  const token = required(env, 'CATALOG_TOKEN')
  const id = required(env, 'CATALOG_TEST_FIXTURE_ID')
  const country = required(env, 'CATALOG_TEST_COUNTRY')
  if (!isId(id) || !isSupportedTerritory(country)) throw new Error('Invalid fixture ID or country')

  let marketplace
  if (!originOnly) {
    const host = required(env, 'RAPIDAPI_HOST')
    const actor = required(env, 'APIFY_ACTOR_ID')
    const apifyToken = required(env, 'APIFY_TOKEN')
    const budget = Number(required(env, 'APIFY_TEST_MAX_USD'))
    const plans = [
      { label: 'Basic', key: required(env, 'RAPIDAPI_FREE_KEY'), expected: env.RAPIDAPI_FREE_LIMIT ?? '100' },
      { label: 'Pro', key: required(env, 'RAPIDAPI_PRO_KEY'), expected: env.RAPIDAPI_PRO_LIMIT ?? '10000' },
      { label: 'Ultra', key: required(env, 'RAPIDAPI_ULTRA_KEY'), expected: env.RAPIDAPI_ULTRA_LIMIT ?? '50000' }
    ]
    if (!/^[a-z0-9-]+\.p\.rapidapi\.com$/i.test(host)) throw new Error('Invalid RAPIDAPI_HOST')
    if (new Set(plans.map(plan => plan.key)).size !== plans.length) {
      throw new Error('Use a separate RapidAPI key for each test subscription')
    }
    if (!/^[a-z0-9_-]+(?:~[a-z0-9_-]+)?$/i.test(actor)) throw new Error('Invalid APIFY_ACTOR_ID')
    if (!Number.isFinite(budget) || budget <= 0) throw new Error('APIFY_TEST_MAX_USD must be a positive spending limit')
    marketplace = { host, actor, apifyToken, budget, plans }
  }

  const auth = { Authorization: `Bearer ${token}` }
  const query = `/v1/fixtures/${id}?country=${country}`
  const { data: health } = await expectJson(request, 'Hosted API readiness', `${origin}/healthz`, { headers: auth })
  if (health.status !== 'ready') throw new Error('The hosted API does not have an approved catalog')
  const unauthenticated = await request(`${origin}${query}`, {
    redirect: 'error', signal: AbortSignal.timeout(15_000)
  })
  if (unauthenticated.status !== 401) throw new Error('The hosted API did not reject an unauthenticated request')
  const { data } = await expectJson(request, 'Hosted fixture', `${origin}${query}`, { headers: auth })
  const sample = data.data
  const signature = fixtureSignature(sample, id, country)
  if (originOnly) return { origin: 'passed', fixtureId: id, country }

  for (const { label, key, expected } of marketplace.plans) {
    const result = await expectJson(request, `RapidAPI ${label} request`, `https://${marketplace.host}${query}`, {
      headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': marketplace.host }
    })
    if (result.headers.get('x-ratelimit-requests-limit') !== String(expected)) {
      throw new Error(`RapidAPI ${label} did not report the expected request quota (${expected})`)
    }
    if (fixtureSignature(result.data.data, id, country) !== signature) {
      throw new Error(`RapidAPI ${label} returned different fixture data from the hosted API`)
    }
  }

  const exportUrl = new URL(`https://api.apify.com/v2/actors/${marketplace.actor}/run-sync-get-dataset-items`)
  exportUrl.searchParams.set('timeout', '75')
  exportUrl.searchParams.set('maxTotalChargeUsd', String(marketplace.budget))
  const { data: rows } = await expectJson(request, 'Apify test export', exportUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${marketplace.apifyToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      country, season: sample.seasonId, from: sample.date, to: sample.date,
      broadcastsOnly: true, maxRecords: 30
    })
  }, 90_000)
  if (!Array.isArray(rows) || rows.length > 30) throw new Error('Apify returned an invalid export size')
  const found = rows.filter(fixture => fixture.id === id)
  if (found.length !== 1 || fixtureSignature(found[0], id, country) !== signature) {
    throw new Error('Apify exported different fixture data from the hosted API')
  }
  return { origin: 'passed', rapidapi: marketplace.plans.map(plan => plan.label), apify: 'passed', fixtureId: id, country }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = process.argv.slice(2)
  if (flags.some(flag => flag !== '--origin')) throw new Error('Usage: npm run catalog:verify-launch -- [--origin]')
  try {
    console.log(JSON.stringify(await verifyMarketplaceLaunch(process.env, fetch, { originOnly: flags.includes('--origin') })))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
