import fs from 'node:fs'
import path from 'node:path'
import { parsePartnerDocs } from '../partnerDocs.js'

export function loadPartnerDocs(file = path.join(process.cwd(), 'docs', 'partner-api.md')) {
  return parsePartnerDocs(fs.readFileSync(file, 'utf8'))
}
