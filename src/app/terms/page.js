import { loadLegal } from '../../lib/server/legalContent'
import { SITE_URL } from '../../lib/legal'
import LegalDocument from '../../components/LegalDocument'

const doc = loadLegal('terms')

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Terms of Service',
  description: doc.description,
  alternates: { canonical: '/terms' },
  robots: { index: true, follow: true },
}

export default function Page() {
  return <LegalDocument doc={doc} />
}
