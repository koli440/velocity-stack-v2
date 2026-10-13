// Daily bot run: node scripts/bots/daily.mjs [--date YYYY-MM-DD]
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_URL (deployed app exposing /api/analyze)
import { adminClient, ensureBots, runBotDay, followBack, today } from './lib.mjs'

const dateArg = process.argv.indexOf('--date')
const date = dateArg > -1 ? process.argv[dateArg + 1] : today()
const appUrl = process.env.APP_URL
if (!appUrl) throw new Error('APP_URL is required')

const sb = adminClient()
const bots = await ensureBots(sb)
let failures = 0
for (const bot of bots) {
  try {
    console.log(`${bot.persona.key} ${date}: ${await runBotDay(sb, bot, date, appUrl)}`)
  } catch (err) {
    failures++
    console.error(`${bot.persona.key} ${date}: ${err.message}`)
  }
}
console.log(`follow-backs: ${await followBack(sb, bots)}`)
process.exit(failures ? 1 : 0)
