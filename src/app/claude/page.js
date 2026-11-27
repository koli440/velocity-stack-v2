import Link from 'next/link'
import Icon from '../../components/Icon'
import CarryLink from '../../components/CarryLink'
import { publicPage } from '../../lib/seo'
import { jsonLdString } from '../../lib/geo'
import { SCOPE_LABELS } from '../../lib/partnerScopes'
import { MCP_SCOPES } from '../../lib/mcp/discovery'
import { CLAUDE_PATH, CLAUDE_TITLE, CLAUDE_DESCRIPTION, claudeJsonLd } from '../../lib/publicPages'

export const metadata = publicPage(CLAUDE_PATH, CLAUDE_TITLE, CLAUDE_DESCRIPTION)

const card = 'glass-dense rounded-2xl border border-slate-200 dark:border-surface-darkBorder bg-white/60 dark:bg-surface-darkCard/40 p-5'
const h2 = 'text-2xl font-black text-slate-900 dark:text-white'
const h3 = 'font-bold text-slate-900 dark:text-white'
const link = 'font-semibold text-emerald-600 dark:text-brand-neon hover:underline'
const code = 'rounded bg-slate-100 dark:bg-slate-900 px-1 font-mono text-[13px]'
const btnSecondary = 'inline-flex items-center justify-center px-6 py-3 rounded-xl border border-slate-300 dark:border-surface-darkBorder font-bold text-base text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-white/5'
const btnPrimary = 'inline-flex items-center justify-center px-6 py-3 rounded-xl bg-emerald-500 dark:bg-brand-neon text-slate-950 font-bold text-base hover:opacity-90'

const MCP_URL = 'https://www.velocity-stack.app/api/mcp'
const DIRECTORY_URL = 'https://claude.ai/directory/velocity-stack'

const CAN_DO = [
  ['calendar', 'Plan your training', 'Add workouts to your calendar with an interval structure, change, move, skip or delete them, and keep your races and day notes up to date. Structured rides reach Garmin, Wahoo or Intervals.icu like any planned workout, when you have turned that on.'],
  ['chart', 'Review your rides', 'Activities with power, heart rate, cadence, peaks, time in zones and splits, next to the planned workout they completed. No GPS data is shared.'],
  ['clipboard', 'Run analysis templates', 'Run your own, public or system templates on a ride and see every interval it found, stored just as if you had run it yourself.'],
  ['trend', 'Check fitness and form', 'Fitness, fatigue and form from your training load, the weekly ramp and the daily trend, plus your FTP, weight, zones and upcoming races.'],
]

const TOOLS = [
  ['get_athlete', 'FTP, weight, W/kg, lactate thresholds, power zones and upcoming races.'],
  ['list_planned_workouts', 'Planned workouts between two dates with status and structure.'],
  ['create_planned_workout', 'Plans a workout (ride, track, gym, run or other) on a day.'],
  ['update_planned_workout', 'Changes title, notes, discipline, day or structure.'],
  ['move_planned_workout', 'Moves a planned workout to another day.'],
  ['skip_planned_workout', 'Marks a planned workout as skipped, or planned again.'],
  ['delete_planned_workout', 'Deletes a planned workout.'],
  ['list_races', 'Races (goals) in your calendar, with priority A, B or C.'],
  ['create_race', 'Adds a race to your calendar.'],
  ['update_race', 'Changes a race.'],
  ['delete_race', 'Deletes a race.'],
  ['list_notes', 'Day notes such as sickness, travel or availability.'],
  ['create_note', 'Adds a note to a day.'],
  ['update_note', 'Changes a note.'],
  ['delete_note', 'Deletes a note.'],
  ['list_activities', 'Completed activities between two dates.'],
  ['get_activity', 'Details of one activity: summary, peaks, zones, splits, template results.'],
  ['list_templates', 'Analysis templates you can run.'],
  ['run_template', 'Runs a template on one of your activities.'],
  ['get_fitness', 'Fitness, fatigue and form with the daily trend.'],
  ['get_macro_plan', 'Your season plan, when your coach has published one (or, for coaches, an athlete’s plan).'],
]

const PROMPTS = [
  'Plan next week around my A race: two interval sessions, one long endurance ride, rest on Monday.',
  'How did yesterday’s ride compare with the planned workout? Find the intervals and their power.',
  'My form is very negative. Move Thursday’s VO2max session to Saturday and make Thursday an easy spin.',
  'Show my fitness, fatigue and form for the last six weeks and tell me whether I’m ramping too fast.',
]

export default function ClaudePage() {
  return (
    <article className="max-w-5xl mx-auto space-y-14 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(claudeJsonLd()) }} />

      <header className="space-y-4 text-center py-8 sm:py-12">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-600 dark:text-brand-neon">VelocityStack connector for Claude</p>
        <h1 className="text-4xl sm:text-5xl font-black leading-tight text-slate-900 dark:text-white">Plan and review your training with Claude</h1>
        <p className="max-w-2xl mx-auto text-base sm:text-lg">
          Connect Claude to your VelocityStack account. Claude can then plan workouts in your calendar and look at what you actually rode, with your own
          thresholds, templates and fitness. You approve exactly what it may do, and you can disconnect it any time.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <a href={DIRECTORY_URL} className={btnPrimary} target="_blank" rel="noopener noreferrer">Connect in Claude</a>
          <CarryLink href="/register" className={btnSecondary}>Create a free account</CarryLink>
        </div>
      </header>

      <section aria-labelledby="can-do" className="space-y-5">
        <h2 id="can-do" className={h2}>What Claude can do</h2>
        <ul className="grid gap-4 sm:grid-cols-2">
          {CAN_DO.map(([icon, t, d]) => (
            <li key={t} className={card}>
              <h3 className={h3}><Icon name={icon} /> {t}</h3>
              <p className="mt-1">{d}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="connect" className="space-y-4">
        <h2 id="connect" className={h2}>Connect</h2>
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            Open <a href={DIRECTORY_URL} className={link} target="_blank" rel="noopener noreferrer">VelocityStack in Claude&apos;s connector directory</a>, or in Claude open{' '}
            <strong>Settings &rarr; Connectors</strong> and search for <strong>VelocityStack</strong>.
          </li>
          <li>Click <strong>Connect</strong>. You are sent to VelocityStack: sign in, check the permissions and press <strong>Allow</strong>.</li>
          <li>Back in Claude, ask about your training. Claude asks before it changes anything in your calendar.</li>
        </ol>
        <p>
          <strong className="text-slate-900 dark:text-white">Claude Code:</strong> run{' '}
          <code className={code}>claude mcp add --transport http velocity-stack {MCP_URL}</code>, then <code className={code}>/mcp</code> to sign in.
        </p>
        <p>
          The server address for any other MCP client is <code className={code}>{MCP_URL}</code> (Streamable HTTP, OAuth 2.0). Developers: see the{' '}
          <Link href="/developers/docs" className={link}>API documentation</Link>.
        </p>
      </section>

      <section aria-labelledby="permissions" className="space-y-4">
        <h2 id="permissions" className={h2}><Icon name="lock" /> Permissions</h2>
        <p>The VelocityStack consent page lists what Claude asks for:</p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {MCP_SCOPES.map((s) => (
            <li key={s} className={card}>
              <code className={code}>{s}</code>
              <p className="mt-1">{SCOPE_LABELS[s]}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="tools" className="space-y-4">
        <h2 id="tools" className={h2}>Tools</h2>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {TOOLS.map(([t, d]) => (
            <div key={t}>
              <dt><code className={code}>{t}</code></dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
        <p>Coaches can also plan in an active athlete&apos;s calendar. Everything else works on your own account only.</p>
      </section>

      <section aria-labelledby="prompts" className="space-y-4">
        <h2 id="prompts" className={h2}>Things to ask</h2>
        <ul className="list-disc pl-5 space-y-1">
          {PROMPTS.map((p) => <li key={p}>&ldquo;{p}&rdquo;</li>)}
        </ul>
        <p>
          Workout structures use the VelocityStack interval syntax, which Claude writes for you. See the <Link href="/dsl-guide" className={link}>syntax guide</Link>.
        </p>
      </section>

      <section aria-labelledby="privacy" className="space-y-4">
        <h2 id="privacy" className={h2}>Privacy and control</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Claude only sees what the tools return, for the account that approved the connection. GPS tracks, email addresses and connection keys are never shared.</li>
          <li>VelocityStack does not receive your Claude conversations. It logs which tools changed data (not what you asked) to keep the service secure.</li>
          <li>Disconnect any time on the <Link href="/connections" className={link}>Connections</Link> page; access stops immediately. You can also remove the connector in Claude.</li>
          <li>Details in the <Link href="/privacy" className={link}>privacy policy</Link>.</li>
        </ul>
      </section>

      <section aria-labelledby="help" className="space-y-3">
        <h2 id="help" className={h2}>Help</h2>
        <p>
          Something not working or missing? Tell us on the <Link href="/feedback" className={link}>feedback</Link> page.
        </p>
      </section>
    </article>
  )
}
