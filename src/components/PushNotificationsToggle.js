'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase, getAuthHeader } from '../lib/supabase'
import { deviceLabel, pushSupportState, urlBase64ToBytes, validateSubscription } from '../lib/push'

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''

// One on/off switch per device for system (Web Push) notifications. Permission is only requested on click.
export default function PushNotificationsToggle() {
  const [state, setState] = useState('hidden')
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    const hasPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    const ua = navigator.userAgent || ''
    const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
    const next = pushSupportState({ hasKey: !!PUBLIC_KEY, hasPush, isIOS, standalone, permission: hasPush ? Notification.permission : 'default' })
    setState(next)
    if (next === 'available' || next === 'blocked') {
      try {
        const reg = await navigator.serviceWorker.getRegistration()
        const sub = await reg?.pushManager.getSubscription()
        setOn(!!sub && Notification.permission === 'granted')
      } catch {
        setOn(false)
      }
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  if (state === 'hidden') return null

  const enable = async () => {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return refresh()
    const reg = await navigator.serviceWorker.ready
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBytes(PUBLIC_KEY),
    }))
    const valid = validateSubscription(sub)
    if (!valid) throw new Error('This browser returned an unusable push subscription')
    const { error } = await supabase.rpc('save_push_subscription', {
      p_endpoint: valid.endpoint, p_p256dh: valid.p256dh, p_auth: valid.auth, p_user_agent: deviceLabel(navigator.userAgent),
    })
    if (error) throw new Error(error.message)
    setOn(true)
    setMessage('Enabled on this device.')
  }

  const disable = async () => {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (sub) {
      await supabase.rpc('delete_push_subscription', { p_endpoint: sub.endpoint })
      await sub.unsubscribe().catch(() => {})
    }
    setOn(false)
    setMessage('Disabled on this device.')
  }

  const onToggle = async () => {
    setBusy(true)
    setMessage('')
    try {
      await (on ? disable() : enable())
    } catch (e) {
      setMessage(e?.message || 'Could not change push notifications')
    }
    setBusy(false)
  }

  const sendTest = async () => {
    setBusy(true)
    setMessage('')
    try {
      const res = await fetch('/api/notifications/push/send-test', { method: 'POST', headers: await getAuthHeader() })
      const json = await res.json().catch(() => ({}))
      setMessage(res.ok ? 'Test notification sent.' : json.error || 'Could not send the test notification')
    } catch {
      setMessage('Could not send the test notification')
    }
    setBusy(false)
  }

  const hint = {
    'ios-install': 'On iPhone/iPad, add Velocity Stack to your Home Screen (Share → Add to Home Screen, iOS 16.4+) and open it from there to enable pop-up notifications.',
    unsupported: "This browser doesn't support system notifications.",
    blocked: 'Notifications are blocked for this site. Allow them in your browser or device settings, then reload this page.',
  }[state]

  return (
    <div className="space-y-1" data-testid="push-notifications">
      <label className="flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={on} disabled={busy || state !== 'available'} onChange={onToggle} data-testid="push-toggle" />
        <span>
          Pop-up notifications on this device {on ? '(on)' : state === 'available' ? '(off)' : ''}
        </span>
      </label>
      {hint && <p className="text-[11px] text-slate-500 dark:text-slate-400 pl-6">{hint}</p>}
      {on && state === 'available' && (
        <p className="pl-6">
          <button type="button" onClick={sendTest} disabled={busy} className="text-[11px] font-bold text-emerald-600 dark:text-brand-neon hover:underline disabled:opacity-50">
            Send test notification
          </button>
        </p>
      )}
      {message && <p className="text-[11px] text-slate-500 dark:text-slate-400 pl-6" role="status">{message}</p>}
    </div>
  )
}
