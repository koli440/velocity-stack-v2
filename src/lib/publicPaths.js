// Content pages that are public (crawlable, usable logged out). Edit controls inside them stay signed-in only.
const EXACT = ['/about', '/dsl-guide', '/whats-new', '/how-it-works', '/velodromes']

export const isPublicContentPath = (pathname) => {
  const p = String(pathname || '').replace(/\/+$/, '') || '/'
  return EXACT.includes(p) || p.startsWith('/velodromes/')
}
