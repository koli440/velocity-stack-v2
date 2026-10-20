/** Bearer token of a request ('' when absent). */
export function bearerToken(req) {
  return (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
}

/**
 * The (unverified) `sub` claim of a JWT, or null. Only for starting queries in parallel with the
 * verification round-trip (auth.getUser): PostgREST validates the signature itself and RLS uses the
 * verified uid, and callers MUST still check getUser's user.id against it before returning anything.
 */
export function jwtSubject(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1] || '', 'base64url').toString('utf8'))
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null
  } catch {
    return null
  }
}
