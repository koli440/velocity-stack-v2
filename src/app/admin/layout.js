import { noindex } from '../../lib/seo'

export const metadata = noindex('Admin')

export default function Layout({ children }) {
  return children
}
