'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { useCoachModule } from '../../../components/useCoachModule'
import CoachQuestionsEditor from '../../../components/CoachQuestionsEditor'
import CoachLicenceEditor from '../../../components/CoachLicenceEditor'
import CoachBillingPanel from '../../../components/CoachBillingPanel'
import Icon from '../../../components/Icon'
import { AdminPage, AdminMessage, ErrorNote, StatusNote, adminCard, adminInput, adminBtn, adminMuted } from '../../../components/admin/AdminUi'
import {
  ACCENTS, BIO_MAX, CURRENCIES, DISCIPLINE_OPTIONS, HEADLINE_MAX, INTERVALS, PACKAGE_KINDS, PACKAGE_MAX,
  cardPath, cardUrl, coachCardErrorMessage, fetchMyCoachCard, parseList, saveCoachCard, setCoachCardVisibility,
  validateCard,
} from '../../../lib/coachCard'

const field = adminInput
const label = 'block text-sm font-semibold text-slate-800 dark:text-slate-100 mb-1'
const hint = `text-xs mt-1 ${adminMuted}`
const h2 = 'text-base font-extrabold text-slate-900 dark:text-white'
const btn = adminBtn.primary
const EMPTY = { slug: '', headline: '', bio: '', accent: 'orange', disciplines: [], languages: [], location: '', accepting_athletes: true, max_athletes: '', packages: [] }

export default function CoachCardSettingsPage() {
  const enabled = useCoachModule()
  const [card, setCard] = useState(null)
  const [saved, setSaved] = useState(false)
  const [disc, setDisc] = useState('')
  const [langs, setLangs] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { card: c } = await fetchMyCoachCard(supabase)
    if (c) {
      setCard({ ...c, max_athletes: c.max_athletes ?? '' })
      setDisc((c.disciplines || []).join(', '))
      setLangs((c.languages || []).join(', '))
      setSaved(true)
    } else {
      setCard({ ...EMPTY })
    }
  }, [])
  useEffect(() => { if (enabled) load() }, [enabled, load])

  if (!enabled) return <AdminMessage>The coach module is not available for your account yet.</AdminMessage>
  if (!card) return <AdminMessage>Loading…</AdminMessage>

  const set = (patch) => setCard((c) => ({ ...c, ...patch }))
  const setPkg = (i, patch) => set({ packages: card.packages.map((p, j) => (j === i ? { ...p, ...patch } : p)) })

  const save = async (e) => {
    e.preventDefault()
    const next = { ...card, disciplines: parseList(disc), languages: parseList(langs) }
    const problem = validateCard(next)
    if (problem) return setMsg({ error: true, text: problem })
    setBusy(true)
    const { error } = await saveCoachCard(supabase, next)
    setBusy(false)
    if (error) return setMsg({ error: true, text: coachCardErrorMessage(error) })
    setMsg({ text: 'Saved.' })
    load()
  }

  const visibility = async (isPublic, isListed) => {
    setBusy(true)
    const { error } = await setCoachCardVisibility(supabase, isPublic, isListed)
    setBusy(false)
    setMsg(error ? { error: true, text: coachCardErrorMessage(error) } : { text: 'Updated.' })
    load()
  }

  return (
    <AdminPage title="Coach card" description="Your public coaching profile: how athletes find you and what you offer." back={{ href: '/settings', label: 'Settings' }} width="max-w-2xl">
      {msg && (msg.error ? <ErrorNote>{msg.text}</ErrorNote> : <StatusNote>{msg.text}</StatusNote>)}
      <form onSubmit={save} className="space-y-5">
        <section className={`${adminCard} space-y-4`}>
        <h2 className={h2}>Profile</h2>
        <div>
          <label className={label} htmlFor="cc-slug">Link name</label>
          <input id="cc-slug" className={field} value={card.slug} onChange={(e) => set({ slug: e.target.value.toLowerCase() })} maxLength={30} />
          <p className={`${hint} break-all`}>{cardUrl(card.slug || 'your-name')}</p>
        </div>
        <div>
          <label className={label} htmlFor="cc-headline">Headline</label>
          <input id="cc-headline" className={field} value={card.headline} maxLength={HEADLINE_MAX} onChange={(e) => set({ headline: e.target.value })} />
        </div>
        <div>
          <label className={label} htmlFor="cc-bio">About you</label>
          <textarea id="cc-bio" rows={6} className={field} value={card.bio} maxLength={BIO_MAX} onChange={(e) => set({ bio: e.target.value })} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="cc-loc">Location</label>
            <input id="cc-loc" className={field} value={card.location} maxLength={60} onChange={(e) => set({ location: e.target.value })} />
          </div>
          <div>
            <label className={label} htmlFor="cc-accent">Colour</label>
            <select id="cc-accent" className={field} value={card.accent} onChange={(e) => set({ accent: e.target.value })}>
              {Object.keys(ACCENTS).map((a) => <option key={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="cc-disc">Disciplines (comma separated)</label>
            <input id="cc-disc" className={field} value={disc} list="cc-disc-list" onChange={(e) => setDisc(e.target.value)} />
            <datalist id="cc-disc-list">{DISCIPLINE_OPTIONS.map((d) => <option key={d} value={d} />)}</datalist>
          </div>
          <div>
            <label className={label} htmlFor="cc-lang">Languages (comma separated)</label>
            <input id="cc-lang" className={field} value={langs} onChange={(e) => setLangs(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="cc-max">Athlete limit (empty = no limit)</label>
            <input id="cc-max" type="number" min="1" max="500" className={field} value={card.max_athletes} onChange={(e) => set({ max_athletes: e.target.value })} />
          </div>
          <label className="flex items-center gap-3 min-h-[44px] text-sm font-semibold text-slate-800 dark:text-slate-100 self-end">
            <input type="checkbox" className="h-5 w-5 accent-orange-500" checked={card.accepting_athletes} onChange={(e) => set({ accepting_athletes: e.target.checked })} /> Accepting new athletes
          </label>
        </div>
        </section>

        <section className={`${adminCard} space-y-3`}>
          <div>
            <h2 className={h2}>Packages</h2>
            <p className={hint}>Shown as text on your card; online payment comes later.</p>
          </div>
          {card.packages.map((p, i) => (
            <div key={p.id || i} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3 space-y-2">
              <input aria-label="Package title" className={field} value={p.title || ''} maxLength={60} onChange={(e) => setPkg(i, { title: e.target.value })} />
              <textarea aria-label="Package description" rows={2} className={field} value={p.description || ''} maxLength={300} onChange={(e) => setPkg(i, { description: e.target.value })} />
              <div className="flex flex-wrap gap-2">
                <select aria-label="Package type" className={field + ' sm:!w-auto'} value={p.kind} onChange={(e) => setPkg(i, { kind: e.target.value })}>
                  {Object.entries(PACKAGE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                {p.kind === 'subscription' && (
                  <select aria-label="Renews" className={field + ' sm:!w-auto'} value={p.interval || ''} onChange={(e) => setPkg(i, { interval: e.target.value })}>
                    <option value="">Renews…</option>
                    {Object.keys(INTERVALS).map((k) => <option key={k}>{k}</option>)}
                  </select>
                )}
                {p.kind !== 'free' && (
                  <>
                    <input aria-label="Price" type="number" min="0" step="0.01" className={field + ' sm:!w-28'} value={p.amount_cents == null ? '' : p.amount_cents / 100}
                      onChange={(e) => setPkg(i, { amount_cents: e.target.value === '' ? null : Math.round(Number(e.target.value) * 100) })} />
                    <select aria-label="Currency" className={field + ' sm:!w-auto'} value={p.currency || 'eur'} onChange={(e) => setPkg(i, { currency: e.target.value })}>
                      {CURRENCIES.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                    </select>
                  </>
                )}
                <button type="button" className={adminBtn.danger} onClick={() => set({ packages: card.packages.filter((_, j) => j !== i) })}><Icon name="trash" /> Remove</button>
              </div>
            </div>
          ))}
          {card.packages.length < PACKAGE_MAX && (
            <button type="button" className={adminBtn.secondary} onClick={() => set({ packages: [...card.packages, { title: '', description: '', kind: 'subscription', interval: 'month', amount_cents: null, currency: 'eur' }] })}><Icon name="plus" /> Add package</button>
          )}
        </section>
        <div className="flex flex-wrap items-center gap-3">
          <button className={btn} disabled={busy}>{busy ? 'Saving…' : 'Save card'}</button>
        </div>
      </form>

      {saved && (
        <section className={`${adminCard} space-y-3`}>
          <h2 className={h2}>Visibility</h2>
          <p className={`text-sm ${adminMuted}`}>
            Your card is {card.is_public ? 'public' : 'private'}{card.is_listed ? ' and listed in the coach directory' : ''}.
            {card.is_public && <> <Link className="font-bold underline text-orange-700 dark:text-orange-400" href={cardPath(card.slug)}>View it</Link>.</>}
          </p>
          <div className="flex flex-wrap gap-2">
            <button className={card.is_public ? adminBtn.secondary : adminBtn.primary} disabled={busy} onClick={() => visibility(!card.is_public, card.is_public ? false : card.is_listed)}>{card.is_public ? 'Unpublish' : 'Publish'}</button>
            {card.is_public && <button className={adminBtn.secondary} disabled={busy} onClick={() => visibility(true, !card.is_listed)}>{card.is_listed ? 'Remove from directory' : 'List in directory'}</button>}
          </div>
        </section>
      )}
      {saved && <CoachQuestionsEditor />}
      {saved && <CoachLicenceEditor />}
      {saved && <CoachBillingPanel />}
    </AdminPage>
  )
}
