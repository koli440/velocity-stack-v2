import { noindex } from '../../lib/seo'

export const metadata = noindex('Templates')

export default function Layout({ children }) {
  return children
}
