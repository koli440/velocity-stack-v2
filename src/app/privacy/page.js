import { loadLegal } from '../../lib/server/legalContent'
import { SITE_URL } from '../../lib/legal'
import LegalDocument from '../../components/LegalDocument'

const doc = loadLegal('privacy')

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Privacy Policy',
  description: doc.description,
  alternates: { canonical: '/privacy' },
  robots: { index: true, follow: true },
}

export default function Page() {
  return <LegalDocument doc={doc} />
}
