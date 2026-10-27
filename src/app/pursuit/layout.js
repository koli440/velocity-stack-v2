import { publicPage } from '../../lib/seo'

export const metadata = publicPage(
  '/pursuit',
  'Pursuit Strategist',
  'Plan a track pursuit: enter a target time and get lap-by-lap splits and a pacing strategy for your velodrome.'
)

export default function Layout({ children }) {
  return children
}
