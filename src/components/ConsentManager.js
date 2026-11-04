'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Portal from './Portal'
import useModalA11y from './useModalA11y'
import { redditPixelSnippet } from '../lib/redditPixel'
import {
  buildConsentRecord, readConsent, writeConsent, googleConsentState, allowedScripts, needsReload,
  thirdPartyCookieNames, GOOGLE_CONSENT_DENIED, OPEN_SETTINGS_EVENT,
} from '../lib/consent'

function ensureGtag() {
  window.dataLayer = window.dataLayer || []
  if (typeof window.gtag !== 'function') {
    window.gtag = function gtag() { window.dataLayer.push(arguments) }
  }
}

function loadedFlags() {
  return (window.__vsConsentLoaded = window.__vsConsentLoaded || {})
}

// Consent Mode v2: defaults are pushed before any Google tag exists; the tag itself loads only after analytics consent.
function applyConsent(record, ids) {
  ensureGtag()
  const flags = loadedFlags()
  if (!flags.defaults) {
    window.gtag('consent', 'default', { ...GOOGLE_CONSENT_DENIED, wait_for_update: 500 })
    flags.defaults = true
  }
  if (record) window.gtag('consent', 'update', googleConsentState(record))
  const allowed = allowedScripts(record)
  if (allowed.ga && ids.ga && !flags.ga) {
    flags.ga = true
    window.gtag('js', new Date())
    window.gtag('config', ids.ga)
    const s = document.createElement('script')
    s.async = true
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ids.ga)}`
    document.head.appendChild(s)
  }
  if (allowed.reddit && ids.reddit && !flags.reddit) {
    flags.reddit = true
    const s = document.createElement('script')
    s.text = redditPixelSnippet(ids.reddit)
    document.head.appendChild(s)
  }
}

function clearThirdPartyCookies() {
  const names = thirdPartyCookieNames(document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter(Boolean))
  const host = window.location.hostname
  const domains = [undefined, host, `.${host}`, `.${host.split('.').slice(-2).join('.')}`]
  for (const name of names) {
    for (const d of domains) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${d ? `; domain=${d}` : ''}`
    }
  }
}

const btn = 'min-h-[44px] px-4 rounded-lg text-sm font-semibold border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500'
const link = 'underline underline-offset-2 hover:text-slate-900 dark:hover:text-white'

function Toggle({ id, label, desc, checked, disabled, onChange }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-t border-slate-200 dark:border-slate-700">
      <div>
        <label htmlFor={id} className="text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</label>
        <p id={`${id}-desc`} className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">{desc}</p>
      </div>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="mt-1 h-5 w-5 shrink-0 accent-emerald-600"
        checked={checked}
        disabled={disabled}
        aria-describedby={`${id}-desc`}
        onChange={(e) => onChange?.(e.target.checked)}
      />
    </div>
  )
}

function SettingsDialog({ initial, onSave, onClose }) {
  const ref = useModalA11y(true, onClose)
  const [analytics, setAnalytics] = useState(initial.analytics)
  const [marketing, setMarketing] = useState(initial.marketing)
  return (
    <Portal>
      <div className="fixed inset-0 z-[10001] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby="cookie-dialog-title"
          tabIndex={-1}
          className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-2xl p-5 focus:outline-none"
        >
          <h2 id="cookie-dialog-title" className="text-lg font-bold text-slate-900 dark:text-white">Cookie settings</h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 mb-3">
            Choose which optional cookies we may use. You can change or withdraw your choice at any time from “Cookie settings” in the footer. See the <Link href="/privacy#11-cookies-and-local-storage" className={link}>Privacy Policy</Link> for the full list.
          </p>
          <Toggle id="consent-necessary" label="Strictly necessary" desc="Keeps you signed in (Supabase session) and remembers preferences such as theme and your cookie choice. Always on." checked disabled />
          <Toggle id="consent-analytics" label="Analytics" desc="Google Analytics 4 measures how pages are used so we can improve the app." checked={analytics} onChange={setAnalytics} />
          <Toggle id="consent-marketing" label="Marketing" desc="Google Ads signals and Reddit Pixel measure the results of our advertising campaigns." checked={marketing} onChange={setMarketing} />
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button type="button" className={btn} onClick={() => onSave({ analytics: false, marketing: false })}>Reject all</button>
            <button type="button" className={btn} data-autofocus onClick={() => onSave({ analytics, marketing })}>Save choices</button>
            <button type="button" className={btn} onClick={() => onSave({ analytics: true, marketing: true })}>Accept all</button>
          </div>
        </div>
      </div>
    </Portal>
  )
}

export default function ConsentManager({ gaId, redditId }) {
  const [ready, setReady] = useState(false)
  const [record, setRecord] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const ids = useRef({ ga: gaId, reddit: redditId })
  const recordRef = useRef(null)

  useEffect(() => {
    let stored = null
    try { stored = readConsent(window.localStorage) } catch {}
    recordRef.current = stored
    setRecord(stored)
    setReady(true)
    applyConsent(stored, ids.current)
    const open = () => setShowSettings(true)
    window.addEventListener(OPEN_SETTINGS_EVENT, open)
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, open)
  }, [])

  const save = useCallback((choice) => {
    const next = buildConsentRecord(choice)
    try { writeConsent(window.localStorage, next) } catch {}
    const prev = recordRef.current
    recordRef.current = next
    setRecord(next)
    setShowSettings(false)
    applyConsent(next, ids.current)
    if (needsReload(prev, next)) {
      clearThirdPartyCookies()
      window.location.reload()
    }
  }, [])

  if (!ready) return null
  return (
    <>
      {!record && !showSettings && (
        <div
          role="region"
          aria-label="Cookie consent"
          className="fixed inset-x-0 bottom-0 z-[10000] p-3 sm:p-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 shadow-2xl p-4 sm:p-5">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">We value your privacy</p>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
              We use strictly necessary storage to run VelocityStack. With your permission we also use analytics and marketing cookies (Google Analytics, Google Ads, Reddit Pixel). Nothing optional loads until you choose. <Link href="/privacy#11-cookies-and-local-storage" className={link}>Learn more</Link>
            </p>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button type="button" className={btn} onClick={() => save({ analytics: false, marketing: false })}>Reject all</button>
              <button type="button" className={btn} onClick={() => save({ analytics: true, marketing: true })}>Accept all</button>
              <button type="button" className={btn} onClick={() => setShowSettings(true)}>Customize</button>
            </div>
          </div>
        </div>
      )}
      {showSettings && (
        <SettingsDialog
          initial={{ analytics: record?.analytics === true, marketing: record?.marketing === true }}
          onSave={save}
          onClose={() => setShowSettings(false)}
        />
      )}
    </>
  )
}
