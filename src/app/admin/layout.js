import { noindex } from '../../lib/seo'
import { PathBreadcrumb } from '../../components/PageBreadcrumb'

export const metadata = noindex('Admin')

export default function Layout({ children }) {
  return (
    <>
      <PathBreadcrumb className="max-w-6xl mx-auto px-4 sm:px-6 pt-4" />
      {children}
    </>
  )
}
