import Icon from './Icon'
import PageBreadcrumb from './PageBreadcrumb'
import { settingsCrumbs } from '../lib/settingsProfile'

export const settingsCard = 'glass-dense rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder p-5 md:p-6'
export const settingsInput = 'w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500'
export const settingsLabel = 'block text-[10px] uppercase font-bold text-slate-400 mb-1'
export const settingsCheck = 'flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-300'

/** Common frame of every settings page: breadcrumb (Settings > Page), title and description. */
export default function SettingsShell({ page, title, description, children }) {
  return (
    <section className="max-w-3xl mx-auto space-y-6">
      <div>
        <PageBreadcrumb items={settingsCrumbs(page)} className="mb-2" />
        <h1 className="text-3xl font-black text-slate-900 dark:text-white flex items-center gap-2">
          <Icon name="settings" /> {title}
        </h1>
        {description && <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {children}
    </section>
  )
}

/** Sticky-free Save button + "Saved" flag shared by the pages that edit profile fields. */
export function SaveBar({ saving, disabled, saved }) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="submit"
        disabled={saving || disabled}
        className="flex-1 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-slate-950 font-bold text-xs uppercase tracking-wider transition shadow-md disabled:opacity-50"
      >
        {saving ? 'Saving profile...' : 'Save Changes'}
      </button>
      {saved && <span className="text-xs font-bold text-emerald-500">Saved</span>}
    </div>
  )
}
