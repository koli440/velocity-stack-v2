// Prints an idempotent upsert for system templates from src/lib/systemTemplates.js.
// Usage: node scripts/generate-system-templates-sql.mjs [slug-prefix ...] > supabase/migrations/<ts>_<name>.sql
// With no arguments every catalogue template is emitted; with prefixes only matching slugs.
import { ALL_SYSTEM_TEMPLATES, systemTemplatesUpsertSql } from '../src/lib/systemTemplates.js'

const prefixes = process.argv.slice(2)
const templates = prefixes.length
  ? ALL_SYSTEM_TEMPLATES.filter((t) => prefixes.some((p) => t.slug.startsWith(p)))
  : ALL_SYSTEM_TEMPLATES
if (!templates.length) {
  console.error('No catalogue templates matched')
  process.exit(1)
}
process.stdout.write(systemTemplatesUpsertSql(templates))
