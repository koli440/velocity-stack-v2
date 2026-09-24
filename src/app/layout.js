import { Plus_Jakarta_Sans } from 'next/font/google'
import { ThemeProvider } from '../components/ThemeProvider'
import './globals.css'

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'] })

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning className={jakarta.className}>
      <body className="bg-surface-light dark:bg-surface-dark text-slate-800 dark:text-slate-100 transition-colors duration-300">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
