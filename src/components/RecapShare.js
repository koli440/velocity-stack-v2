'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { recapShareUrl, recapShareText } from '../lib/recap'
import { recapPngBlob, downloadBlob } from '../lib/recapImage'
import { trackRecapEvent } from '../lib/recapTracking'

const btn = 'px-3 py-2 text-xs font-bold rounded-lg'

// Owner controls: private by default. "Create public link" is the explicit opt-in; "Stop sharing" revokes it
// (the old link stops working; sharing again creates a new one). Download PNG never publishes anything.
export default function RecapShare({ year, recap, name, avatarUrl = null }) {
  const [slug, setSlug] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    let live = true
    supabase.rpc('get_season_recap_share', { p_year: year }).then(({ data }) => {
      if (!live) return
      setSlug(data || null)
      setLoaded(true)
    })
    return () => { live = false }
  }, [year])

  const url = slug ? recapShareUrl(slug, window.location.origin) : null

  const enable = async () => {
    setBusy(true)
    setMsg(null)
    const { data, error } = await supabase.rpc('enable_season_recap_share', { p_year: year })
    setBusy(false)
    if (error || !data) return setMsg('Could not create the link. Try again.')
    setSlug(data)
    trackRecapEvent('recap_share', { year, method: 'enable' })
  }

  const revoke = async () => {
    setBusy(true)
    setMsg(null)
    const { error } = await supabase.rpc('revoke_season_recap_share', { p_year: year })
    setBusy(false)
    if (error) return setMsg('Could not stop sharing. Try again.')
    setSlug(null)
    setMsg('Sharing stopped. The old link no longer works.')
  }

  const share = async () => {
    const text = recapShareText(year, name)
    try {
      if (navigator.share) {
        await navigator.share({ title: text, text, url })
        trackRecapEvent('recap_share', { year, method: 'web_share' })
      } else {
        await navigator.clipboard.writeText(url)
        setMsg('Link copied.')
        trackRecapEvent('recap_share', { year, method: 'copy_link' })
      }
    } catch (e) {
      if (e?.name !== 'AbortError') setMsg('Sharing failed. Copy the link instead.')
    }
  }

  const download = async () => {
    const blob = await recapPngBlob(recap, name, avatarUrl)
    if (!blob) return setMsg('Could not create the image.')
    const file = new File([blob], `velocity-stack-${year}-recap.png`, { type: 'image/png' })
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: recapShareText(year, name) })
        trackRecapEvent('recap_share', { year, method: 'web_share_png' })
        return
      } catch (e) {
        if (e?.name === 'AbortError') return
      }
    }
    downloadBlob(blob, file.name)
    trackRecapEvent('recap_share', { year, method: 'download_png' })
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-black uppercase tracking-widest text-brand-neon">Share your season</p>
      {!loaded ? (
        <p className="text-sm text-slate-300">Loading…</p>
      ) : url ? (
        <>
          <p className="text-sm text-slate-300">Anyone with this link can see your totals. No ride titles, routes or exact locations are shown.</p>
          <input readOnly value={url} aria-label="Public recap link" onFocus={(e) => e.target.select()} className="w-full rounded-lg bg-slate-900 border border-slate-600 px-3 py-2 text-xs text-white" />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={share} className={`${btn} bg-brand-neon text-slate-900`}>Share</button>
            <button type="button" onClick={download} className={`${btn} border border-slate-500 text-white`}>Download PNG</button>
            <button type="button" onClick={revoke} disabled={busy} className={`${btn} border border-red-400 text-red-300 disabled:opacity-50`}>Stop sharing</button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-300">Your recap is private. Create a public link to share it: it shows your first name or nickname, your profile picture and season totals only, and you can turn it off any time.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={enable} disabled={busy} className={`${btn} bg-brand-neon text-slate-900 disabled:opacity-50`}>Create public link</button>
            <button type="button" onClick={download} className={`${btn} border border-slate-500 text-white`}>Download PNG</button>
          </div>
        </>
      )}
      {msg && <p role="status" className="text-xs text-slate-300">{msg}</p>}
    </div>
  )
}
