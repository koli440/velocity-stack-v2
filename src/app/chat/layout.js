import { noindex } from '../../lib/seo'

export const metadata = noindex('Messages')

export default function Layout({ children }) {
  return children
}
