import './globals.css'
import { ThemeProvider } from '../components/ThemeProvider' // Your existing theme provider
import AppShell from '../components/AppShell'

export const metadata = {
  title: 'VelocityStack | Velodrome Telemetry Platform',
  description: 'Pure speed, cadence & power durational analysis for track cyclists',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased font-sans">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  )
}