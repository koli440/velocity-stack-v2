import { NextResponse } from 'next/server'
import { loadNews } from '../../../lib/server/newsContent'

// Static: built from content/news at deploy time. No secrets, no database.
export const dynamic = 'force-static'

export function GET() {
  return NextResponse.json({ entries: loadNews() })
}
