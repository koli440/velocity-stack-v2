import ImportCta, { ImportViewTracker } from './ImportCta'
import { registerHref } from '../lib/signupCatch'
import { CONNECTIONS_PATH } from '../lib/rideSources'

const btnPrimary = 'inline-flex items-center justify-center px-6 py-3 rounded-xl bg-emerald-500 dark:bg-brand-neon text-slate-950 font-bold text-base hover:opacity-90'
const btnSecondary = 'inline-flex items-center justify-center px-6 py-3 rounded-xl border border-slate-300 dark:border-surface-darkBorder font-bold text-base text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-white/5'

// Shared call to action for the import pages: register (back to Connections afterwards), or open Connections when signed in.
export default function ImportCtaRow({ slug, placement }) {
  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <ImportCta href={registerHref(CONNECTIONS_PATH)} slug={slug} cta={`${placement}-register`} className={btnPrimary}>
        Create a free account
      </ImportCta>
      <ImportCta href={CONNECTIONS_PATH} slug={slug} cta={`${placement}-connections`} className={btnSecondary}>
        Already a member? Open Connections
      </ImportCta>
    </div>
  )
}

export { ImportViewTracker }
