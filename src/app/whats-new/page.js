import { loadNews } from '../../lib/server/newsContent'
import WhatsNewView from '../../components/WhatsNewView'

export const metadata = {
  title: "What's new",
  description: 'Recent features and improvements in VelocityStack.',
  alternates: { canonical: '/whats-new' },
}

export default function WhatsNewPage() {
  return <WhatsNewView entries={loadNews()} />
}
