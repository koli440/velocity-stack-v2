// src/lib/server/partnerProvider.js
//
// Adapter for the shared import pipeline (importActivity.js) serving rides pushed by partner apps.
// The upload is already in memory, so fetchActivity just analyses it. Activities are stored with
// source = 'partner' and external_source = 'partner:<app slug>'.

import { analyzeStreams } from '../streamAnalysis.js'
import { ImportError } from './importErrors.js'
import { sportFromFit, RIDE_SPORTS } from '../sportType.js'
import { DEFAULT_SPORT, localStamp, parseGpx, parseTcx, fileExtension } from '../partnerUpload.js'

/**
 * @param {object} args
 * @param {string} args.slug - developer app slug
 * @param {{ kind: 'json', streams: object[], samples: number, start: {iso:string,offsetMin:number} }
 *  | { kind: 'fit', blob: Blob, filename: string, start?: {iso:string,offsetMin:number} }
 *  | { kind: 'xml', text: string, ext: 'gpx'|'tcx', start?: {iso:string,offsetMin:number} }} args.input
 * @param {string|null} [args.title]
 * @param {string|null} [args.sport] - explicit canonical ride sport; otherwise detected (FIT) or 'virtual'
 */
export function createPartnerProvider({ slug, input, title = null, sport = null }) {
  return {
    source: 'partner',
    externalSource: `partner:${slug}`,

    async fetchActivity(_externalId, { gearing = {}, analyzeFit } = {}) {
      if (input.kind === 'fit') return fromFit(input, { gearing, analyzeFit, title, sport })
      const prepared =
        input.kind === 'xml'
          ? (input.ext === 'gpx' ? parseGpx : parseTcx)(input.text)
          : { streams: input.streams, startMs: Date.parse(input.start.iso), samples: input.samples }
      const startIso = input.start?.iso || new Date(prepared.startMs).toISOString()
      const analyzed = analyzeStreams(prepared.streams, gearing)
      if (!analyzed) throw new ImportError('The upload has no usable data.', 422)
      analyzed.summary.start_time = startIso
      analyzed.summary.elapsed_time_s = prepared.samples
      return {
        title,
        startDateLocal: localStamp(startIso, input.start?.offsetMin || 0),
        sport: sport || DEFAULT_SPORT,
        ...analyzed,
      }
    },
  }
}

async function fromFit(input, { gearing, analyzeFit, title, sport }) {
  if (!analyzeFit) throw new ImportError('FIT import needs the .fit analyzer.', 500)
  const parsed = await analyzeFit(input.blob, input.filename || 'upload.fit', gearing).catch(() => null)
  if (!parsed?.success) throw new ImportError('The .fit file could not be analysed.', 422)
  const detected = sportFromFit(parsed.summary)
  const resolved = sport || (RIDE_SPORTS.includes(detected) ? detected : detected ? null : DEFAULT_SPORT)
  if (!resolved) throw new ImportError('Only cycling activities are accepted in this API version.', 422)
  const startIso = input.start?.iso || parsed.summary.start_time || null
  if (!parsed.summary.start_time && startIso) parsed.summary.start_time = startIso
  return {
    title,
    startDateLocal: startIso ? localStamp(startIso, input.start?.offsetMin || 0) : undefined,
    sport: resolved,
    summary: parsed.summary,
    curves: parsed.curves,
    time_series: parsed.time_series || {},
    strength: parsed.strength,
  }
}

export { fileExtension }
