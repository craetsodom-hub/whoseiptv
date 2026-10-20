import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const feedDirectory = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'feed/events/v1')
const port = Number(process.argv[3] ?? 8765)
const autoRefresh = process.argv.includes('--refresh')
if (![8765, 8766].includes(port)) throw new Error('Only local preview ports 8765 and 8766 are supported')
const files = new Map([
  ['/feed/events/v1/events.json', resolve(feedDirectory, 'events.json')],
  ['/feed/events/v1/coverage.json', resolve(feedDirectory, 'coverage.json')],
])
let refreshing = false
async function refresh() {
  if (refreshing) return
  refreshing = true
  try {
    await new Promise((complete, reject) => {
      const child = spawn(process.execPath, [resolve(root, 'scripts/refresh-bein-preview.mjs'), feedDirectory], { cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'inherit'] })
      child.once('error', reject)
      child.once('exit', code => code === 0 ? complete() : reject(Error('Source refresh failed')))
    })
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), previewRefresh: 'ok' }))
  } catch { console.error(JSON.stringify({ checkedAt: new Date().toISOString(), previewRefresh: 'failed', previousExpiryRetained: true })) }
  finally { refreshing = false }
}
if (autoRefresh) {
  refresh()
  setInterval(refresh, 60 * 60_000).unref()
}

createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
  const file = files.get(path)
  if (!file || request.method !== 'GET') {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Not found')
    return
  }
  try {
    const body = await readFile(file)
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': body.length })
    response.end(body)
  } catch {
    response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Feed unavailable')
  }
}).listen(port, '127.0.0.1', () => console.log(`Local WhoseIPTV feed available at http://127.0.0.1:${port}`))
