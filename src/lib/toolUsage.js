// Anonymous usage events for the public calculators (Gear Architect, Pursuit Strategist), see docs/analytics.md.
// Sent to the track_tool_event() RPC: no user id, IP, cookie or localStorage identifier is sent or stored. The server decides
// "signed in" from the request itself. Each distinct event is sent at most once per page load; failures are ignored.

const sent = new Set()

/** Normalises event arguments to the RPC payload (strict, so the server never has to reject). */
export function toolEventParams(tool, event, extra = {}) {
  const distance = Number(extra.distanceM)
  return {
    p_tool: tool,
    p_event: event,
    p_discipline: typeof extra.discipline === 'string' && extra.discipline.trim() ? extra.discipline.trim().slice(0, 40) : null,
    p_distance_m: Number.isFinite(distance) && distance > 0 ? Math.round(distance) : null,
    p_my_pacing: typeof extra.myPacing === 'boolean' ? extra.myPacing : null,
    p_reason: extra.reason || null,
  }
}

/** Fire-and-forget; repeated identical events in the same page load are skipped. Returns true when sent. */
export function trackToolEvent(client, tool, event, extra = {}) {
  const params = toolEventParams(tool, event, extra)
  const key = JSON.stringify(params)
  if (!client || sent.has(key)) return false
  sent.add(key)
  try {
    Promise.resolve(client.rpc('track_tool_event', params)).catch(() => {})
  } catch {
    // tracking must never break the tool
  }
  return true
}

export function resetToolEventsForTests() {
  sent.clear()
}
