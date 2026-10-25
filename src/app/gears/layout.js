import { publicPage } from '../../lib/seo'

export const metadata = publicPage(
  '/gears',
  'Gear Architect',
  'Plan track gearing: compare chainring and sprocket combinations, gear inches and rollout for your velodrome.'
)

export default function Layout({ children }) {
  return children
}
