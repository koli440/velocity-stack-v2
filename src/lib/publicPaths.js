// Content pages that are public (crawlable, usable logged out). Edit controls inside them stay signed-in only.
const EXACT = ['/about', '/dsl-guide', '/whats-new', '/how-it-works', '/velodromes']

// Free calculators usable without an account. Personal extras inside them stay signed-in only.
export const PUBLIC_TOOL_PATHS = ['/gears', '/pursuit']

const clean = (pathname) => String(pathname || '').replace(/\/+$/, '') || '/'

export const isPublicContentPath = (pathname) => {
  const p = clean(pathname)
  return EXACT.includes(p) || p.startsWith('/velodromes/')
}

export const isPublicToolPath = (pathname) => {
  const p = clean(pathname)
  return PUBLIC_TOOL_PATHS.some((t) => p === t || p.startsWith(`${t}/`))
}
