import './globals.css'
import Script from 'next/script'
import { ThemeProvider } from '../components/ThemeProvider' // Your existing theme provider
import ServiceWorkerRegister from '../components/ServiceWorkerRegister'
import AppShell from '../components/AppShell'
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION } from '../lib/seo'
import { redditPixelSnippet } from '../lib/redditPixel'
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
        {GA_ID && (
          <>
            <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
            <Script id="ga4-init" strategy="afterInteractive">
              {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config',${JSON.stringify(GA_ID)});`}
            </Script>
          </>
        )}
        {REDDIT_PIXEL_ID && (
          <Script id="reddit-pixel" strategy="afterInteractive">
            {redditPixelSnippet(REDDIT_PIXEL_ID)}
          </Script>
        )}
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  )
}