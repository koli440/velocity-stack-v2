// Sign-up catch for the public tools (Gear Architect, Pursuit Strategist): links that bring a visitor
// back to the same tool after registering/signing in. `next` is validated by the shared auth helpers.
import { safeNextPath } from './authRedirect.js'

export const CATCH_DISMISS_KEY = 'vs.toolCatchDismissed'

export function authHref(base, pathname) {
  const next = safeNextPath(pathname)
  return next && next !== '/' ? `${base}?next=${encodeURIComponent(next)}` : base
}

export const registerHref = (pathname) => authHref('/register', pathname)
export const loginHref = (pathname) => authHref('/login', pathname)

// The banner appears only after the visitor has actually used the calculator (3+ input changes).
export const CATCH_THRESHOLD = 3
export const shouldShowCatch = ({ interactions, dismissed, signedIn }) =>
  !signedIn && !dismissed && interactions >= CATCH_THRESHOLD
