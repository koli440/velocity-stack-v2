// src/lib/httpJson.js
//
// Shared helper for safely parsing `fetch` responses that are expected to be JSON.
//
// Context (bugfix for Intervals.icu import, follow-up to issue #11/#18): platform-level
// failures (gateway timeouts, proxy error pages, auth walls, etc.) can return an HTML error
// page instead of the JSON body an API route normally produces. Calling `res.json()` directly
// on such a response throws a cryptic `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`
// error. This helper checks the `Content-Type` header first and raises a clear, user-facing
// error instead.

/**
 * @param {Response} res - a fetch Response expected to carry a JSON body.
 * @returns {Promise<any>} the parsed JSON body.
 * @throws {Error} if the response is not JSON.
 */
export async function parseJsonResponse(res) {
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    throw new Error(
      `Server vrátil neočekávanou odpověď (HTTP ${res.status}). Zkuste import prosím opakovat.`
    )
  }
  return res.json()
}
