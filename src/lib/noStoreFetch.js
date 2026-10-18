// Next 14 patches fetch and caches GETs in route handlers (Data Cache); supabase-js
// reads go through fetch, so force every request-scoped query to bypass it.
export function noStoreFetch(input, init = {}) {
  return fetch(input, { ...init, cache: 'no-store' })
}
