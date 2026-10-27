// Submit all sitemap URLs to IndexNow. The key is public by design (served from public/<key>.txt).
// Usage: npm run indexnow [-- --sitemap https://velocity-stack.app/sitemap.xml] [--dry-run]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HOST = 'velocity-stack.app'
const ORIGIN = `https://${HOST}`
const ENDPOINT = 'https://api.indexnow.org/indexnow'
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const si = args.indexOf('--sitemap')
const sitemap = si >= 0 ? args[si + 1] : `${ORIGIN}/sitemap.xml`

const keyFile = fs.readdirSync(path.join(root, 'public')).find((f) => /^[a-f0-9]{32}\.txt$/.test(f))
if (!keyFile) throw new Error('No IndexNow key file (public/<key>.txt) found')
const key = keyFile.replace('.txt', '')
if (fs.readFileSync(path.join(root, 'public', keyFile), 'utf8').trim() !== key) {
  throw new Error('Key file content does not match its name')
}

const xml = sitemap.startsWith('http')
  ? await (await fetch(sitemap)).text()
  : fs.readFileSync(sitemap, 'utf8')
const urlList = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
  .map((m) => m[1].replace(/&amp;/g, '&'))
  .filter((u) => u.startsWith(`${ORIGIN}/`) || u === ORIGIN)
if (!urlList.length) throw new Error(`No URLs found in ${sitemap}`)

const body = { host: HOST, key, keyLocation: `${ORIGIN}/${keyFile}`, urlList }
if (dryRun) {
  console.log(JSON.stringify(body, null, 2))
  process.exit(0)
}
const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
})
console.log(`IndexNow: ${res.status} ${res.statusText} (${urlList.length} URLs)`)
const text = await res.text()
if (text) console.log(text)
process.exit(res.ok ? 0 : 1)
