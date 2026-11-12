import { renderRecapOg, RECAP_OG_ALT } from '../../../../lib/recapOg'
import { loadSharedRecap } from '../../../../lib/server/sharedRecap'

export const alt = RECAP_OG_ALT
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const dynamic = 'force-dynamic'

export default async function Image({ params }) {
  return renderRecapOg(await loadSharedRecap(params.slug))
}
