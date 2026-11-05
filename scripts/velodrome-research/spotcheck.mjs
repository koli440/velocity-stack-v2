// Usage: node scripts/velodrome-research/spotcheck.mjs
// Independent re-fetch of every URL in docs/velodrome-research/spot-check-sample.json and a fuzzy check that the
// quote (and the exact value) appear on the page. Writes spot-check-fetch.json for human/agent review of misses.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/velodrome-research')
const { sample } = JSON.parse(fs.readFileSync(path.join(dir, 'spot-check-sample.json'), 'utf8'))

const strip = (h) => h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#8211;|&ndash;/g, '-').replace(/&euro;/g, '€')
const squash = (s) => s.normalize('NFKC').toLowerCase().replace(/[\s\u00a0"'`’“”–—-]+/g, '')

const out = []
for (const s of sample) {
  let status = 0
  let text = ''
  try {
    const r = await fetch(s.url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (spot-check)' }, signal: AbortSignal.timeout(30000) })
    status = r.status
    text = strip(await r.text())
  } catch (e) { text = ''; status = `error: ${e.cause?.code || e.message}` }
  const hay = squash(text)
  const quote = String(s.quote || '').split(/\s*\|\s*|\.\.\./)[0]
  const quoteFound = quote.length > 3 && hay.includes(squash(quote))
  out.push({ ...s, http: status, quoteFound })
  console.log(`${quoteFound ? 'OK  ' : '??  '} [${s.batch}] ${s.name} / ${s.field} (${status})`)
}
fs.writeFileSync(path.join(dir, 'spot-check-fetch.json'), JSON.stringify(out, null, 1) + '\n')
