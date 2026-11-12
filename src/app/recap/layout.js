import { noindex } from '../../lib/seo'

// Recaps are personal: never indexed (the public share page also sets its own metadata).
export const metadata = noindex('Season recap')

export default function RecapLayout({ children }) {
  return children
}
