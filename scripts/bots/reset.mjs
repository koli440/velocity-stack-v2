// Reset/reseed bots: node scripts/bots/reset.mjs [--backfill-days 60] [--keep-data]
// Removes all bot activities, PBs and bot-owned follows (keeps real users' follows of bots),
// makes sure the bot accounts exist, then regenerates N days of history up to today.
import { adminClient, ensureBots, runBotDay, followBack, today, dateRange, addDays } from './lib.mjs'

const arg = (name, def) => {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : def
}
const days = Number(arg('--backfill-days', 60))
const keep = process.argv.includes('--keep-data')
const appUrl = process.env.APP_URL
if (days > 0 && !appUrl) throw new Error('APP_URL is required for backfill')

const sb = adminClient()
const bots = await ensureBots(sb)
const ids = bots.map((b) => b.id)

if (!keep) {
  for (const table of ['activities', 'personal_bests']) {
    const { error } = await sb.from(table).delete().in('user_id', ids)
    if (error) throw error
  }
  const { error } = await sb.from('follows').delete().in('follower_id', ids)
  if (error) throw error
  console.log('bot data cleared')
}

const end = today()
for (const date of dateRange(addDays(end, -(days - 1)), end)) {
  for (const bot of bots) {
    try {
      await runBotDay(sb, bot, date, appUrl)
    } catch (err) {
      console.error(`${bot.persona.key} ${date}: ${err.message}`)
    }
  }
}
console.log(`follow-backs: ${await followBack(sb, bots)}`)
