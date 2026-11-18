// Pure helpers behind the menu tree: active state, group auto-open and remembered open groups.

export const OPEN_GROUPS_KEY = 'velocity:nav-open-groups'

export const isGroup = (node) => node?.type === 'group'

function splitHref(href) {
  const [path, query = ''] = String(href || '').split('?')
  return { path: path || '/', params: new URLSearchParams(query) }
}

const stripSlash = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p)

/** True when `pathname` is the node's page (a prefix match unless `exact`); query-aware leaves also compare their params. */
export function isLeafActive(item, pathname, search = '') {
  if (!item?.href) return false
  const { path } = splitHref(item.href)
  const here = stripSlash(pathname || '')
  const pathOk = item.exact ? here === path : here === path || here.startsWith(`${path}/`)
  if (!pathOk) return false
  if (!item.query) return true
  const params = new URLSearchParams(search || '')
  return Object.entries(item.query).every(([k, v]) => (params.get(k) ?? item.queryDefaults?.[k]) === v)
}

/** True when the leaf or any of its children is the active page. */
export function isNodeActive(node, pathname, search = '') {
  if (isGroup(node)) return groupContains(node, pathname, search)
  return isLeafActive(node, pathname, search) || (node.children || []).some((c) => isLeafActive(c, pathname, search))
}

export function groupContains(group, pathname, search = '') {
  const here = stripSlash(pathname || '')
  if ((group.matches || []).some((m) => here === m || here.startsWith(`${m}/`))) return true
  return (group.children || []).some((c) => isNodeActive(c, pathname, search))
}

/** Key of the group that holds the current page (null when the page is a top-level entry). */
export function activeGroupKey(tree, pathname, search = '') {
  const g = tree.find((n) => isGroup(n) && groupContains(n, pathname, search))
  return g ? g.key : null
}

/** Remembered open groups, tolerant of missing or corrupt storage. */
export function parseOpenGroups(raw) {
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((k) => typeof k === 'string') : []
  } catch {
    return []
  }
}

export const serializeOpenGroups = (keys) => JSON.stringify([...new Set(keys)])

/** Remembered groups plus the group of the current page (which always opens). */
export function withActiveGroupOpen(openKeys, activeKey) {
  const keys = [...(openKeys || [])]
  if (activeKey && !keys.includes(activeKey)) keys.push(activeKey)
  return keys
}

export function toggleGroup(openKeys, key) {
  return (openKeys || []).includes(key) ? openKeys.filter((k) => k !== key) : [...(openKeys || []), key]
}

/** Total unread of the list shown in the menu badge ("9+" style cap for the compact bottom bar). */
export function badgeLabel(n, cap = 99) {
  const v = Number(n) || 0
  if (v <= 0) return ''
  return v > cap ? `${cap}+` : String(v)
}
