'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { buildNavTree } from '../lib/navigation'
import { breadcrumbTrail } from '../lib/navState'

/** Where-am-I trail shown above pages whose sections live in the menu, e.g. "Lab › Durability". items: [{ label, href? }]. */
export default function PageBreadcrumb({ items = [], className = '' }) {
  if (!items.length) return null
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-x-1.5 text-xs font-bold text-slate-500 dark:text-slate-400">
        {items.map((it, i) => {
          const last = i === items.length - 1
          return (
            <li key={`${i}-${it.label}`} className="flex items-center gap-1.5 min-w-0">
              {i > 0 && <span aria-hidden="true">›</span>}
              {it.href && !last ? (
                <Link href={it.href} className="inline-flex items-center min-h-[44px] lg:min-h-0 hover:text-orange-600 dark:hover:text-orange-400 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded">
                  {it.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className={last ? 'text-slate-800 dark:text-slate-100 truncate' : ''}>{it.label}</span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function FromPath({ className }) {
  const pathname = usePathname() || ''
  const search = useSearchParams()?.toString() ?? ''
  const tree = buildNavTree({ signedIn: true, isAdmin: true, moduleEnabled: true })
  const items = breadcrumbTrail(tree, pathname, search)
  // Detail pages (e.g. /admin/suggestions/<id>): the section crumb becomes a link back to its list.
  const last = items[items.length - 1]
  if (last && !last.href) {
    const find = (nodes) => nodes.flatMap((n) => [n, ...find(n.children || [])]).find((n) => n.label === last.label && n.href)
    const node = find(tree)
    const path = node?.href.split('?')[0]
    if (node && path !== pathname) items[items.length - 1] = { ...last, href: node.href }
  }
  return <PageBreadcrumb items={items} className={className} />
}

/** Breadcrumb derived from the current URL and the menu tree (used by the admin layout). */
export function PathBreadcrumb({ className = '' }) {
  return (
    <Suspense fallback={null}>
      <FromPath className={className} />
    </Suspense>
  )
}
