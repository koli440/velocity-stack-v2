import { loadNews } from '../../lib/server/newsContent'
import WhatsNewView from '../../components/WhatsNewView'

export const metadata = {
  title: "What's new | VelocityStack",
  description: 'Recent features and improvements in VelocityStack.',
}

export default function WhatsNewPage() {
  return <WhatsNewView entries={loadNews()} />
}
