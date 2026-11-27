import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { catalogHandler } from './catalog/api.mjs'
import { indexCatalog } from './catalog/model.mjs'

const path = resolve(process.env.CATALOG_PATH ?? '.season-catalog/catalog.json')
const host = process.env.CATALOG_HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 8780)
const token = process.env.CATALOG_TOKEN
const proxySecret = process.env.RAPIDAPI_PROXY_SECRET
if (!['127.0.0.1', '::1', 'localhost'].includes(host) && !token && !proxySecret) {
  throw new Error('Set CATALOG_TOKEN or RAPIDAPI_PROXY_SECRET when binding to a non-local address')
}

let current
async function snapshot() {
  try {
    const { ino, size, mtimeMs } = await stat(path)
    const revision = `${ino}:${size}:${mtimeMs}`
    if (current?.revision !== revision) {
      const index = indexCatalog(JSON.parse(await readFile(path, 'utf8')))
      current = { revision, index }
    }
    return current.index
  } catch (error) {
    if (current) return current.index
    throw error
  }
}

await snapshot()
createServer(catalogHandler({ snapshot, token, proxySecret })).listen(port, host, () =>
  console.log(`Season catalog listening on ${host}:${port}`))
