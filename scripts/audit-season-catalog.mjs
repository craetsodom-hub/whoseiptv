import { readFile } from 'node:fs/promises'
import { indexCatalog } from './catalog/model.mjs'
import { verifyRelease } from './catalog/release.mjs'

const flags = new Set(process.argv.slice(2).filter(arg => arg.startsWith('--')))
const paths = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
if ([...flags].some(arg => !['--worldwide', '--details'].includes(arg)) || paths.length > 1) {
  throw new Error('Usage: npm run catalog:audit -- [catalog-path] [--worldwide] [--details]')
}
const path = paths[0] ?? process.env.CATALOG_PATH ?? '.season-catalog/catalog.json'
const index = indexCatalog(JSON.parse(await readFile(path, 'utf8')))
const audit = await verifyRelease(index, { worldwide: flags.has('--worldwide'), includeDetails: flags.has('--details') })
console.log(JSON.stringify(audit, null, 2))
if (!audit.ready) process.exitCode = 1
