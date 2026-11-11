// Loads what the absolute-watts conversion needs for a rider: FTP, effective-dated LT1/LT2 and zone percentages.
import { buildPowerBasis } from '../pushPower.js'
import { fetchLtHistory, resolveLtAt, ltFromHistoryEntry } from '../lactateThresholds.js'
import { fetchZoneHistory, resolveZonesAt, zonePctsFromEntry } from '../powerZones.js'

/**
 * Returns `basisFor(date)`; the rider's rows are read once, on first use, so a push cycle costs three queries per rider.
 * Query errors degrade to the FTP-only basis rather than failing the push.
 */
export function createPowerBasisLoader(service, riderId) {
  let loaded = null
  const load = () =>
    (loaded ||= (async () => {
      const [profile, lt, zones] = await Promise.all([
        service.from('profiles').select('ftp_w').eq('id', riderId).maybeSingle(),
        fetchLtHistory(service, riderId).catch(() => ({ history: [] })),
        fetchZoneHistory(service, riderId).catch(() => ({ history: [] })),
      ])
      return { ftp: Number(profile?.data?.ftp_w) > 0 ? Number(profile.data.ftp_w) : null, ltHistory: lt.history || [], zoneHistory: zones.history || [] }
    })())
  return async (date) => {
    const { ftp, ltHistory, zoneHistory } = await load()
    const day = String(date ?? '').slice(0, 10)
    return buildPowerBasis({
      ftp,
      lt: ltFromHistoryEntry(resolveLtAt(ltHistory, day)),
      pcts: zonePctsFromEntry(resolveZonesAt(zoneHistory, day)),
    })
  }
}
