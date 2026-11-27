import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const MAX_BYTES = 2 * 1024 * 1024

export function isImageAsset(bytes, contentType) {
  const type = contentType?.split(';', 1)[0].trim().toLowerCase()
  if (!bytes.length || bytes.length > MAX_BYTES) return false
  const prefix = bytes.subarray(0, 24).toString('latin1')
  if (type === 'image/png') return prefix.startsWith('\x89PNG\r\n\x1a\n') &&
    bytes.subarray(-8, -4).toString('ascii') === 'IEND'
  if (type === 'image/jpeg') return prefix.startsWith('\xff\xd8\xff') && bytes.subarray(-2).toString('hex') === 'ffd9'
  if (type === 'image/gif') return /^GIF8[79]a/.test(prefix) && bytes.at(-1) === 0x3b
  if (type === 'image/webp') return bytes.length >= 12 && /^RIFF....WEBP/s.test(prefix) &&
    bytes.readUInt32LE(4) + 8 === bytes.length
  if (type === 'image/svg+xml') {
    const svg = bytes.toString('utf8')
    return /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg\b/i.test(svg) &&
      /<\/svg>\s*$/i.test(svg)
  }
  return false
}

async function checkLogo(url) {
  // The catalog stores trusted source URLs. Limit every probe to HTTPS,
  // four redirects, twelve seconds and two megabytes.
  const { stdout } = await exec('curl', ['--fail', '--silent', '--show-error', '--location',
    '--proto', '=https', '--proto-redir', '=https', '--max-redirs', '4', '--max-time', '12',
    '--max-filesize', String(MAX_BYTES), '--write-out', '\n%{content_type}', '--', url],
  { encoding: 'buffer', maxBuffer: MAX_BYTES + 256 })
  const separator = stdout.lastIndexOf(10)
  if (separator < 0) return false
  return isImageAsset(stdout.subarray(0, separator), stdout.subarray(separator + 1).toString('ascii'))
}

export async function verifyLogoAssets(index) {
  const urls = [...new Set([...index.competitions.values(), ...index.organizations.values()]
    .map(row => row.logo?.url).filter(Boolean))]
  const results = new Map()
  for (let start = 0; start < urls.length; start += 6) {
    await Promise.all(urls.slice(start, start + 6).map(async url => {
      try {
        results.set(url, await checkLogo(url))
      } catch {
        results.set(url, false)
      }
    }))
  }
  return results
}
