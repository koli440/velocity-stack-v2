import { Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jakarta',
})

export const metadata = {
  title: 'Velocity Stack | Track Cycling Platform',
  description: 'Precision track cycling telemetry, durational curves and velodrome catalog',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${jakarta.variable} font-sans bg-nordic-bg text-nordic-text antialiased`}>
      <body className="min-h-screen selection:bg-nordic-orange selection:text-white">
        {children}
      </body>
    </html>
  )
}
