import { publicPage } from '../../lib/seo'

export const metadata = publicPage(
  '/velodromes',
  'Velodromes directory: length and surface',
  'Directory of velodromes worldwide with track length, surface, indoor or outdoor, location and the track cycling disciplines that fit each track.',
)

export default function Layout({ children }) {
  return children
}
