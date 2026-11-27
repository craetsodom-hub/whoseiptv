import { readFile } from 'node:fs/promises'
import { indexCatalog } from './catalog/model.mjs'
import { auditRelease } from './catalog/release.mjs'
import { verifyLogoAssets } from './catalog/logo-assets.mjs'

const flags = new Set(process.argv.slice(2).filter(arg => arg.startsWith('--')))
const paths = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
if ([...flags].some(arg => arg !== '--worldwide') || paths.length > 1) {
  throw new Error('Usage: npm run catalog:audit -- [catalog-path] [--worldwide]')
}
const path = paths[0] ?? process.env.CATALOG_PATH ?? '.season-catalog/catalog.json'
const index = indexCatalog(JSON.parse(await readFile(path, 'utf8')))
const logoResults = await verifyLogoAssets(index)
const audit = auditRelease(index, { worldwide: flags.has('--worldwide'), logoResults })
console.log(JSON.stringify(audit, null, 2))
if (!audit.ready) process.exitCode = 1
