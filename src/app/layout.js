import './globals.css'
import { ThemeProvider } from '../components/ThemeProvider' // Your existing theme provider
import ServiceWorkerRegister from '../components/ServiceWorkerRegister'
import AppShell from '../components/AppShell'
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION } from '../lib/seo'
import ConsentManager from '../components/ConsentManager'
import { organizationJsonLd, jsonLdString } from '../lib/geo'

export const viewport = {
  viewportFit: 'cover',
  themeColor: '#0F172A',
}

export const metadata = {
  applicationName: 'VelocityStack',
  appleWebApp: { capable: true, title: 'VelocityStack', statusBarStyle: 'black-translucent' },
  metadataBase: new URL(SITE_URL),
  title: { default: 'VelocityStack | Velodrome Telemetry Platform', template: '%s | VelocityStack' },
  description: SITE_DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    url: '/',
    title: 'VelocityStack | Velodrome Telemetry Platform',
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'VelocityStack | Velodrome Telemetry Platform',
    description: SITE_DESCRIPTION,
  },
}

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
const REDDIT_PIXEL_ID = process.env.NEXT_PUBLIC_REDDIT_PIXEL_ID

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased font-sans">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(organizationJsonLd()) }} />
        <ServiceWorkerRegister />
        <ConsentManager gaId={GA_ID} redditId={REDDIT_PIXEL_ID} />
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  )
}