// Reads the legal markdown files from content/legal (shipped with the deploy, no database).
import fs from 'node:fs'
import path from 'node:path'
import { LEGAL_SLUGS, parseLegalDoc } from '../legal.js'

export const LEGAL_DIR = path.join(process.cwd(), 'content', 'legal')

/** A malformed or missing file throws, so it fails the build and the tests. */
export function loadLegal(slug, dir = LEGAL_DIR) {
  if (!LEGAL_SLUGS.includes(slug)) throw new Error(`unknown legal document "${slug}"`)
  try {
    return parseLegalDoc(fs.readFileSync(path.join(dir, `${slug}.md`), 'utf8'), slug)
  } catch (e) {
    throw new Error(`content/legal/${slug}.md: ${e.message}`)
  }
}
