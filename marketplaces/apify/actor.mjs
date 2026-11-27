import { Actor } from 'apify'

await Actor.main(async () => {
  const input = await Actor.getInput() ?? {}
  const base = process.env.CATALOG_API_URL
  if (!base) throw new Error('CATALOG_API_URL is required')
  const url = new URL(`${base.replace(/\/+$/, '')}/v1/fixtures`)
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('Use an HTTPS catalog URL')
  }
  for (const key of ['sport', 'competition', 'season', 'kind', 'leagueCountry', 'country', 'organization',
    'from', 'to', 'broadcastsOnly']) {
    if (input[key] !== undefined && input[key] !== '' && (key !== 'broadcastsOnly' || input[key])) url.searchParams.set(key, input[key])
  }
  const headers = { Accept: 'application/json' }
  if (process.env.CATALOG_TOKEN) headers.Authorization = `Bearer ${process.env.CATALOG_TOKEN}`
  if (process.env.RAPIDAPI_KEY) headers['X-RapidAPI-Key'] = process.env.RAPIDAPI_KEY
  if (process.env.RAPIDAPI_HOST) headers['X-RapidAPI-Host'] = process.env.RAPIDAPI_HOST
  const rows = []
  url.searchParams.set('limit', '200')
  do {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`Catalog request failed with status ${response.status}`)
    const { data, generatedAt, nextOffset, total } = await response.json()
    if (!Array.isArray(data) || typeof generatedAt !== 'string' ||
        !Number.isSafeInteger(total) || total < 0 ||
        (nextOffset !== null && nextOffset !== rows.length + data.length) ||
        (!data.length && nextOffset !== null)) {
      throw new Error('Unexpected catalog response')
    }
    if (total > (input.maxRecords ?? 10000)) throw new Error('Export exceeds maxRecords. Narrow the filters or raise maxRecords.')
    if (data.some(row => row.scheduleStatus !== 'current')) throw new Error('A selected season is stale')
    rows.push(...data)
    if (nextOffset === null) {
      if (rows.length !== total) throw new Error('The export count changed during pagination')
      break
    }
    url.searchParams.set('generation', generatedAt)
    url.searchParams.set('offset', nextOffset)
  } while (true)
  const charging = Actor.getChargingManager()
  const { isPayPerEvent, perEventPrices } = charging.getPricingInfo()
  const exportEvent = 'apify-default-dataset-item'
  const chargesPerRow = isPayPerEvent && perEventPrices[exportEvent] > 0
  if (chargesPerRow && charging.calculateMaxEventChargeCountWithinLimit(exportEvent) < rows.length) {
    throw new Error(`The spending limit cannot cover this ${rows.length}-row export. Narrow the filters or raise the limit.`)
  }
  const dataset = chargesPerRow ? await Actor.openDataset() : null
  const existingRows = dataset ? (await dataset.getInfo())?.itemCount : 0
  if (dataset && !Number.isSafeInteger(existingRows)) throw new Error('The export dataset is unavailable.')
  for (let offset = 0; offset < rows.length; offset += 200) {
    await Actor.pushData(rows.slice(offset, offset + 200))
  }
  if (dataset && (await dataset.getInfo())?.itemCount !== existingRows + rows.length) {
    throw new Error('The platform saved only part of the paid export.')
  }
  await Actor.setValue('EXPORT_SUMMARY', {
    records: rows.length, country: input.country ?? null, season: input.season ?? null
  })
})
