import { noindex } from '../../lib/seo'
import AdminNav from '../../components/AdminNav'

export const metadata = noindex('Admin')

export default function Layout({ children }) {
  return (
    <>
      <AdminNav />
      {children}
    </>
  )
}
