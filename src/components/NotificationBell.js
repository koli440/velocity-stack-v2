'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { reviewPath } from '../lib/suggestions'
import { formatDateTime } from '../lib/dateFormat'
import { supabase } from '../lib/supabase'
import Avatar from './Avatar'
import Icon from './Icon'
import { authorName } from '../lib/social'
import {
  fetchNotifications,
  markAllNotificationsRead,
  describeNotification,
  notificationHref,
  countUnread,
} from '../lib/notifications'

const POLL_MS = 60000

// Bell with unread badge and dropdown of recent social notifications (issue #49).
export default function NotificationBell({ userId }) {
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    if (!userId) return
    const { notifications } = await fetchNotifications(supabase, userId)
    setItems(notifications)
  }, [userId])

  useEffect(() => {
    load()
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  const unread = countUnread(items)

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next) {
      await load()
      if (unread > 0) {
        await markAllNotificationsRead(supabase, userId)
        // Keep the dot until the dropdown closes so new items stay highlighted.
      }
    } else {
      load()
    }
  }

  if (!userId) return null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
        className="relative p-2 rounded-xl border border-slate-200 dark:border-slate-800 text-sm"
      >
        <Icon name="bell" size={18} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-orange-500 text-white text-[9px] font-black flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="glass-popover absolute right-0 mt-2 w-72 z-30 p-3 rounded-2xl border bg-white dark:bg-surface-darkCard border-slate-200 dark:border-surface-darkBorder shadow-lg space-y-2">
          {items.length === 0 && <p className="text-xs text-slate-400">No notifications yet.</p>}
          {items.map((n) => (
            <div
              key={n.id}
              className={`flex items-start gap-2 text-xs ${n.read_at ? 'text-slate-500' : 'font-bold text-slate-900 dark:text-white'}`}
            >
              <Avatar url={n.actor?.avatar_url} name={authorName(n.actor)} size="w-6 h-6" textSize="text-[10px]" />
              <div>
                {n.type === 'suggestion_submitted' && n.suggestion_id ? (
                  <Link href={reviewPath(n.suggestion_id)} className="underline">
                    {describeNotification(n, n.actor)}
                  </Link>
                ) : notificationHref(n) ? (
                  <Link href={notificationHref(n)} className="underline">
                    {describeNotification(n, n.actor)}
                  </Link>
                ) : (
                  describeNotification(n, n.actor)
                )}
                <span className="block text-[10px] font-normal text-slate-400">
                  {formatDateTime(n.created_at)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
