import { renderCoachCardOg, COACH_OG_ALT } from '../../../lib/coachCardOg'
import { loadCoachCard } from '../../../lib/server/coachCardStore'

export const alt = COACH_OG_ALT
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const dynamic = 'force-dynamic'

export default async function Image({ params }) {
  return renderCoachCardOg(await loadCoachCard(params.slug))
}
