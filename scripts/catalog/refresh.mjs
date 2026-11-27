import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { indexCatalog } from './model.mjs'
import { verifyRelease } from './release.mjs'

const exec = promisify(execFile)
const builder = fileURLToPath(new URL('../build-season-catalog.mjs', import.meta.url))
const BUILD_TIMEOUT_MS = 10 * 60_000

export async function refreshCatalog({ path, worldwide = false, build, verify = verifyRelease, signal }) {
  await mkdir(dirname(path), { recursive: true })
  const directory = await mkdtemp(join(dirname(path), '.refresh-'))
  const candidate = join(directory, 'catalog.json')
  try {
    signal?.throwIfAborted()
    await build(candidate)
    signal?.throwIfAborted()
    const index = indexCatalog(JSON.parse(await readFile(candidate, 'utf8')))
    const report = await verify(index, { worldwide })
    signal?.throwIfAborted()
    if (!report.ready) return { outcome: 'blocked', report }
    const expires = Date.parse(report.validUntil)
    if (!Number.isFinite(expires) || expires <= Date.now()) throw new Error('Candidate expired before promotion')
    await rename(candidate, path)
    return { outcome: 'published', report }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function inputPaths(directory) {
  if (!directory) return []
  const entries = await readdir(directory, { withFileTypes: true })
  return entries.filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => join(directory, entry.name)).sort()
}

export function startCatalogRefresh({ path, intervalMs, worldwide, inputDirectory }) {
  const controller = new AbortController()
  const { signal } = controller
  let timer
  let current

  function schedule() {
    current = run().finally(() => {
      if (!signal.aborted) timer = setTimeout(schedule, intervalMs)
    })
  }
  async function run() {
    const startedAt = new Date().toISOString()
    try {
      const inputs = await inputPaths(inputDirectory)
      const { outcome, report } = await refreshCatalog({ path, worldwide, signal, build: async candidate => {
        const { stderr } = await exec(process.execPath, [builder, candidate, ...inputs], {
          env: { ...process.env, CATALOG_PREVIOUS_PATH: path },
          signal, timeout: BUILD_TIMEOUT_MS, maxBuffer: 128 * 1024
        })
        if (stderr.trim()) console.warn(stderr.trim())
      } })
      console.log(JSON.stringify({
        event: 'catalog_refresh', outcome, startedAt, checkedAt: report.checkedAt, validUntil: report.validUntil,
        counts: report.counts, issues: Object.fromEntries(Object.entries(report.issues).map(([id, issue]) => [id, issue.count]))
      }))
    } catch (error) {
      if (!signal.aborted) {
        const message = (error.stderr?.trim() || error.message).slice(0, 1000)
        console.error(JSON.stringify({ event: 'catalog_refresh', outcome: 'failed', startedAt, message }))
      }
    }
  }

  schedule()
  return async () => {
    controller.abort()
    clearTimeout(timer)
    await current
  }
}
