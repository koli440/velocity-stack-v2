import { noindex } from '../../lib/seo'

export const metadata = noindex('Settings')

export default function Layout({ children }) {
  return children
}
