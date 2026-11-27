import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { catalogHandler } from './catalog/api.mjs'
import { indexCatalog } from './catalog/model.mjs'
import { summarizeIssues, verifyRelease } from './catalog/release.mjs'
import { startCatalogRefresh } from './catalog/refresh.mjs'

const path = resolve(process.env.CATALOG_PATH ?? '.season-catalog/catalog.json')
const host = process.env.CATALOG_HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 8780)
const token = process.env.CATALOG_TOKEN
const proxySecret = process.env.RAPIDAPI_PROXY_SECRET
const local = ['127.0.0.1', '::1', 'localhost'].includes(host)
const worldwide = process.env.CATALOG_WORLDWIDE === '1'
const refreshMinutes = Number(process.env.CATALOG_REFRESH_MINUTES ?? 0)
const requireComplete = !local || Boolean(token || proxySecret) || worldwide || process.env.CATALOG_REQUIRE_COMPLETE === '1'

if (!local && !token && !proxySecret) {
  throw new Error('Set CATALOG_TOKEN or RAPIDAPI_PROXY_SECRET when binding to a non-local address')
}

if (!Number.isInteger(refreshMinutes) || refreshMinutes < 0 || refreshMinutes > 24 * 60) {
  throw new Error('CATALOG_REFRESH_MINUTES must be an integer from 0 to 1440')
}

let accepted
let rejected
let pending

async function loadSnapshot() {
  try {
    const { ino, size, mtimeMs } = await stat(path)
    const revision = `${ino}:${size}:${mtimeMs}`
    if (accepted?.revision === revision && Date.now() < accepted.validUntil) return accepted.index
    if (rejected?.revision === revision && Date.now() < rejected.retryAt) throw rejected.error
    try {
      const index = indexCatalog(JSON.parse(await readFile(path, 'utf8')))
      let validUntil = Infinity
      if (requireComplete) {
        const report = await verifyRelease(index, { worldwide })
        if (!report.ready) throw new Error(`Catalog release blocked. ${summarizeIssues(report.issues)}`)
        validUntil = Date.parse(report.validUntil)
      }
      accepted = { revision, index, validUntil }
      rejected = undefined
      return index
    } catch (error) {
      rejected = { revision, error, retryAt: Date.now() + 60_000 }
      throw error
    }
  } catch (error) {
    // A bad update can never extend the last good snapshot's verified lifetime.
    if (accepted && Date.now() < accepted.validUntil) return accepted.index
    throw error
  }
}

function snapshot() {
  pending ??= loadSnapshot().finally(() => { pending = undefined })
  return pending
}

if (!requireComplete && refreshMinutes === 0) await snapshot()

const server = createServer(catalogHandler({ snapshot, token, proxySecret, exactOnly: requireComplete }))
let stopRefresh
server.listen(port, host, () => {
  console.log(`Season catalog listening on ${host}:${port}`)
  if (refreshMinutes > 0) {
    stopRefresh = startCatalogRefresh({
      path, intervalMs: refreshMinutes * 60_000, worldwide,
      inputDirectory: process.env.CATALOG_INPUT_DIR
    })
  }
})

function shutdown() {
  server.close()
  void stopRefresh?.()
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
