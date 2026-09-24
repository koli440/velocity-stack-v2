import './globals.css'
import { Analytics } from '@vercel/analytics/next'

export const metadata = {
  title: 'Velocity Stack',
  description: 'The Track Cycling Platform',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
