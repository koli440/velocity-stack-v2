// Reads the "What's new" markdown files from content/news (shipped with the deploy, no secrets, no database).
import fs from 'node:fs'
import path from 'node:path'
import { parseNewsEntry, sortNewestFirst } from '../news.js'

export const NEWS_DIR = path.join(process.cwd(), 'content', 'news')

/** All entries, newest first. A malformed file throws, so it fails the build and the tests instead of hiding. */
export function loadNews(dir = NEWS_DIR) {
  if (!fs.existsSync(dir)) return []
  const entries = []
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.md')) continue
    const name = file.slice(0, -3)
    try {
      entries.push(parseNewsEntry(fs.readFileSync(path.join(dir, file), 'utf8'), name))
    } catch (e) {
      throw new Error(`content/news/${file}: ${e.message}`)
    }
  }
  return sortNewestFirst(entries)
}
