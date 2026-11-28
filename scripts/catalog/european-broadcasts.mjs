import { updateMarket } from './european-leagues.mjs'

export const footballViewing = {
  espnPrice:
    'https://support.espn.com/hc/en-us/articles/40375475974036-ESPN-Select-or-Unlimited-Plans-and-Prices',
  espnAccess:
    'https://support.espn.com/hc/en-us/articles/40375658660244-What-is-the-available-content-on-ESPN-Select',
  france:
    'https://www.laliga.com/en-GB/news/disney-and-dazn-become-the-new-home-of-laliga-ea-sports-in-france',
  disneyPrice: 'https://www.disneyplus.com/fr-fr',
  stanPrice: 'https://www.stan.com.au/sport',
  stan: (id) => 'https://www.stan.com.au/watch/sport/football/' + id
}

function words(html) {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}
const minor = (s) => Math.round(Number(s.replace(',', '.')) * 100)
function upsert(fixture, listing) {
  const existing = fixture.broadcasts.find(
    (b) => b.country === listing.country && b.destinationId === listing.destinationId
  )
  if (existing) Object.assign(existing, listing)
  else fixture.broadcasts.push(listing)
}

export function addLaLigaViewing(batch, pages, evidence) {
  const us = /every match from LALIGA/i.test(words(pages.espnAccess))
  const france =
    /both DAZN and Disney\+ will broadcast 10 matches per matchday, ensuring all 380 matches/i.test(
      words(pages.france)
    ) &&
    /French fans/.test(words(pages.france)) &&
    /2026\/27 season/.test(words(pages.france))
  const offers = (batch.offers ??= [])
  for (const f of batch.fixtures) {
    if (['postponed', 'cancelled'].includes(f.startStatus)) continue
    if (us)
      upsert(f, {
        ...evidence,
        country: 'US',
        name: 'ESPN+',
        destinationId: 'tv-us-espn-plus',
        type: 'service',
        kind: 'live',
        airsAt: null,
        sourceUrl: footballViewing.espnAccess
      })
    if (france)
      for (const [id, name] of [
        ['dazn-fr', 'DAZN'],
        ['disney-plus-fr', 'Disney+']
      ]) {
        upsert(f, {
          ...evidence,
          country: 'FR',
          name,
          destinationId: id,
          type: 'service',
          kind: 'live',
          airsAt: null,
          sourceUrl: footballViewing.france
        })
      }
  }
  if (us) {
    updateMarket(batch, 'US', footballViewing.espnAccess, evidence)
    for (const [billingPeriod, pattern] of [
      ['month', /ESPN Select Monthly Subscription \$(\d+\.\d{2})\/Month/i],
      ['year', /ESPN Select Annual Subscription \$(\d+\.\d{2})\/Year/i]
    ]) {
      const price = words(pages.espnPrice).match(pattern)
      if (price)
        offers.push({
          ...evidence,
          id: 'us-espn-select-laliga-' + billingPeriod,
          country: 'US',
          currency: 'USD',
          provider: 'ESPN',
          plan: 'ESPN Select',
          amountMinor: minor(price[1]),
          billingPeriod,
          competitionIds: ['laliga'],
          destinationIds: ['tv-us-espn-plus'],
          sourceUrl: footballViewing.espnPrice,
          entitlementSourceUrl: footballViewing.espnAccess
        })
    }
  }
  if (france) {
    updateMarket(batch, 'FR', footballViewing.france, evidence)
    const pricePage = words(pages.disneyPrice)
    const price = pricePage.match(/Standard avec pub\s*\((\d+[,.]\d{2})\s*€\s*\/\s*mois/i)
    if (price && /matchs en direct de LALIGA/i.test(pricePage))
      offers.push({
        ...evidence,
        id: 'fr-disney-standard-laliga-month',
        country: 'FR',
        currency: 'EUR',
        provider: 'Disney+',
        plan: 'Standard avec pub',
        amountMinor: minor(price[1]),
        billingPeriod: 'month',
        competitionIds: ['laliga'],
        destinationIds: ['disney-plus-fr'],
        sourceUrl: footballViewing.disneyPrice,
        entitlementSourceUrl: footballViewing.france
      })
  }
}

function teamKey(s) {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\b(?:afc|fc|cf|sc)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
}
const sydney = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Australia/Sydney',
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
})
function localParts(epoch) {
  return Object.fromEntries(sydney.formatToParts(epoch).map((p) => [p.type, p.value]))
}
function minutes(text) {
  const m = text.match(/^(\d{1,2}):(\d{2})(am|pm)$/i)
  if (!m || +m[1] < 1 || +m[1] > 12 || +m[2] > 59) return NaN
  return ((+m[1] % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0)) * 60 + +m[2]
}
function stanAirings(batch, html) {
  const airings = new Map()
  const orgs = new Map(batch.organizations.map((row) => [row.id, row.name]))
  const pairs = new Map()
  for (const f of batch.fixtures) {
    const names = ['home', 'away'].map((role) =>
      orgs.get(f.participants.find((p) => p.role === role)?.organizationId)
    )
    if (!f.startsAt || names.some((n) => !n)) continue
    const pair = names.map(teamKey).join('/')
    const entries = pairs.get(pair) ?? []
    entries.push(f)
    pairs.set(pair, entries)
  }
  for (const [entry] of html.matchAll(
    /<li class="schedule__entry schedule__entry--event"[^>]*>[\s\S]*?<\/li>/g
  )) {
    const date = entry.match(/class="schedule__text">(\w{3}), (\d{2}) (\w{3}) ([\d:]+[ap]m)</i)
    const kickoff = entry.match(/>Kick off ([\d:]+[ap]m)</i)
    const names = ['home', 'away'].map(
      (role) => entry.match(new RegExp('class="team team--' + role + '">\\s*<strong>([^<]+)</strong>'))?.[1]
    )
    if (!date || !kickoff || names.some((n) => !n)) continue
    const diff = (minutes(kickoff[1]) - minutes(date[4]) + 1440) % 1440
    if (!Number.isFinite(diff) || diff > 360) continue
    const matches = []
    for (const f of pairs.get(names.map((n) => teamKey(words(n))).join('/')) ?? []) {
      const time = Date.parse(f.startsAt),
        local = localParts(time),
        air = time - diff * 60_000,
        localAir = localParts(air)
      if (
        +local.hour * 60 + +local.minute !== minutes(kickoff[1]) ||
        +localAir.hour * 60 + +localAir.minute !== minutes(date[4]) ||
        localAir.weekday !== date[1] ||
        localAir.day !== date[2] ||
        localAir.month !== date[3]
      )
        continue
      matches.push([f.id, new Date(air).toISOString()])
    }
    if (matches.length === 1) {
      const [id, air] = matches[0]
      airings.set(id, airings.has(id) && airings.get(id) !== air ? null : air)
    }
  }
  return airings
}

export function addStanViewing(batch, html, pricingHtml, evidence) {
  const competition = batch.competitions[0]
  const id = competition.id
  const sourceUrl = footballViewing.stan(id)
  const all =
    words(html)
      .toLowerCase()
      .includes('every match of ' + competition.name.toLowerCase() + ' in australia') ||
    (id === 'premier-league' && /every match of the Premier League live and on demand/i.test(words(html)))
  const times = stanAirings(batch, html)
  let listed = false
  for (const f of batch.fixtures) {
    if (['postponed', 'cancelled'].includes(f.startStatus)) continue
    if (!times.has(f.id) && (!all || f.phase === 'QUALIFYING')) continue
    upsert(f, {
      ...evidence,
      country: 'AU',
      name: 'Stan Sport',
      destinationId: 'stan-sport-au',
      type: 'service',
      kind: 'live',
      airsAt: times.get(f.id) ?? null,
      sourceUrl
    })
    listed = true
  }
  if (!listed) return
  updateMarket(batch, 'AU', sourceUrl, evidence)
  const price = words(pricingHtml).match(
    /Stan Plans starting at \$(\d+(?:\.\d{2})?) a month Stan Sport In 4K and HD \$(\d+(?:\.\d{2})?) a month/i
  )
  if (!price || !/Add Stan Sport to any Stan plan/i.test(words(pricingHtml))) return
  const offers = (batch.offers ??= [])
  offers.push({
    ...evidence,
    id: 'stan-sport-au-' + id + '-month',
    country: 'AU',
    currency: 'AUD',
    provider: 'Stan',
    plan: 'Starting plan with Stan Sport',
    amountMinor: minor(price[1]) + minor(price[2]),
    billingPeriod: 'month',
    competitionIds: [id],
    destinationIds: ['stan-sport-au'],
    terms: 'Includes the lowest published base plan and the required monthly sport add-on.',
    sourceUrl: footballViewing.stanPrice,
    entitlementSourceUrl: sourceUrl
  })
}

export const mlsMarkets = { US: ['USD', '$'], CA: ['CAD', '$'], GB: ['GBP', '£'], AU: ['AUD', '$'] }
export const appleMlsPage = (country) => 'https://tv.apple.com/' + country.toLowerCase() + '/offer/mls'

export function addMlsViewing(batch, country, html, evidence) {
  const [currency, symbol] = mlsMarkets[country]
  const text = words(html).replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
  if (!/Watch every MLS match, including playoffs, with no blackouts/i.test(text)) return
  const sourceUrl = appleMlsPage(country)
  const destinationId = 'tv-' + country.toLowerCase() + '-apple-tv'
  for (const fixture of batch.fixtures) {
    if (['postponed', 'cancelled'].includes(fixture.startStatus)) continue
    upsert(fixture, {
      ...evidence,
      country,
      name: 'Apple TV',
      destinationId,
      type: 'service',
      kind: 'live',
      airsAt: null,
      sourceUrl
    })
  }
  updateMarket(batch, country, sourceUrl, evidence)
  const price = text.match(/for the first \d+ months, then ([$£])(\d+\.\d{2})\s*\/\s*month/i)
  if (price?.[1] !== symbol) return
  const offers = (batch.offers ??= [])
  offers.push({
    ...evidence,
    id: 'apple-tv-mls-' + country.toLowerCase() + '-monthly',
    country,
    currency,
    provider: 'Apple TV',
    plan: 'Apple TV',
    amountMinor: minor(price[2]),
    billingPeriod: 'month',
    competitionIds: ['mls'],
    destinationIds: [destinationId],
    sourceUrl,
    entitlementSourceUrl: sourceUrl,
    terms: 'Standard monthly renewal price after the introductory offer.'
  })
}
