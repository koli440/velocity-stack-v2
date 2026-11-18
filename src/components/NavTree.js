'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Icon from './Icon'
import { NAV_LOCKED_LABEL, isNavItemLocked } from '../lib/navigation'
import { loginHref } from '../lib/signupCatch'
import {
  OPEN_GROUPS_KEY, activeGroupKey, badgeLabel, isGroup, isLeafActive, isNodeActive,
  parseOpenGroups, serializeOpenGroups, toggleGroup, withActiveGroupOpen,
} from '../lib/navState'

const ACTIVE = 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/10 dark:text-brand-neon font-bold'
const IDLE = 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/60'
const ANCESTOR = 'text-emerald-600 dark:text-brand-neon'

function Badge({ n, testId }) {
  const label = badgeLabel(n)
  if (!label) return null
  return (
    <span data-testid={testId} className="rounded-full bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5" aria-label={`${n} unread`}>
      {label}
    </span>
  )
}

/**
 * The grouped menu shared by the desktop sidebar and the mobile drawer. `search` is the current query string
 * (see NavTree below); `touch` gives every row a 44px tap target.
 */
export function NavTreeView({ tree, pathname, search = '', signedIn, unread = 0, touch = false, onNavigate }) {
  const [open, setOpen] = useState([])
  const activeKey = activeGroupKey(tree, pathname, search)

  useEffect(() => {
    try { setOpen((cur) => withActiveGroupOpen(parseOpenGroups(window.localStorage.getItem(OPEN_GROUPS_KEY)).concat(cur), activeKey)) } catch { setOpen((cur) => withActiveGroupOpen(cur, activeKey)) }
  }, [activeKey])

  const flip = (key) => {
    const next = toggleGroup(open, key)
    setOpen(next)
    try { window.localStorage.setItem(OPEN_GROUPS_KEY, serializeOpenGroups(next)) } catch { /* storage unavailable */ }
  }

  const row = touch ? 'min-h-[44px] py-2.5' : 'py-2.5'
  const subRow = touch ? 'min-h-[44px] py-2.5' : 'py-1.5'
  const base = `w-full text-left flex items-center gap-3 px-4 rounded-xl text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${row}`

  const renderLeaf = (item, { sub = false, parentActive = false } = {}) => {
    const locked = isNavItemLocked(item, signedIn)
    const cls = sub
      ? `w-full flex items-center gap-2 pl-11 pr-3 rounded-lg text-[13px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${subRow}`
      : base
    if (locked) {
      return (
        <Link
          key={item.key}
          href={loginHref(item.href)}
          onClick={onNavigate}
          title={NAV_LOCKED_LABEL}
          aria-label={`${item.label} (${NAV_LOCKED_LABEL})`}
          className={`${cls} ${IDLE} opacity-60`}
        >
          {!sub && item.icon && <Icon name={item.icon} size={18} />}
          <span className="flex-1 truncate">{item.label}</span>
          <Icon name="lock" size={14} />
        </Link>
      )
    }
    const active = isLeafActive(item, pathname, search) && !parentActive
    return (
      <Link
        key={item.key}
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={`${cls} ${active ? ACTIVE : IDLE}`}
      >
        {!sub && item.icon && <Icon name={item.icon} size={18} />}
        <span className="flex-1 truncate">{item.label}</span>
        {item.key === 'messages' && <Badge n={unread} testId="sidebar-unread" />}
        {sub && item.unread > 0 && <Badge n={item.unread} />}
      </Link>
    )
  }

  const renderItem = (item) => {
    const kids = item.children || []
    if (!kids.length) return renderLeaf(item)
    const childActive = kids.some((c) => isLeafActive(c, pathname, search))
    return (
      <div key={item.key} className="space-y-0.5">
        {renderLeaf(item, { parentActive: childActive })}
        {kids.map((c) => renderLeaf(c, { sub: true }))}
      </div>
    )
  }

  const renderGroup = (g) => {
    const isOpen = open.includes(g.key)
    const holdsActive = isNodeActive(g, pathname, search)
    return (
      <div key={g.key}>
        <button
          type="button"
          onClick={() => flip(g.key)}
          aria-expanded={isOpen}
          aria-controls={`nav-group-${g.key}`}
          className={`${base} ${!isOpen && holdsActive ? ANCESTOR : IDLE}`}
        >
          <Icon name={g.icon} size={18} />
          <span className="flex-1">{g.label}</span>
          <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={14} />
        </button>
        {isOpen && (
          <div id={`nav-group-${g.key}`} className="mt-0.5 mb-1 space-y-0.5">
            {g.children.map(renderItem)}
          </div>
        )}
      </div>
    )
  }

  return (
    <nav aria-label="Main" className="space-y-1">
      {tree.map((n) => (isGroup(n) ? renderGroup(n) : renderItem(n)))}
    </nav>
  )
}

function WithSearch(props) {
  const search = useSearchParams()?.toString() ?? ''
  return <NavTreeView {...props} search={search} />
}

/** Menu tree that follows the URL query (Suspense: useSearchParams must not de-opt the whole shell). */
export default function NavTree(props) {
  return (
    <Suspense fallback={<NavTreeView {...props} />}>
      <WithSearch {...props} />
    </Suspense>
  )
}
