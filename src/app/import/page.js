import Link from 'next/link'
import ImportCtaRow, { ImportViewTracker } from '../../components/ImportCtaRow'
import { publicPage } from '../../lib/seo'
import { jsonLdString } from '../../lib/trackLanding'
import {
  IMPORT_GUIDES,
  IMPORT_PATH,
  IMPORT_INDEX_TITLE,
  IMPORT_INDEX_DESCRIPTION,
  importGuidePath,
  guideBlurb,
  breadcrumbJsonLd,
} from '../../lib/importGuides'

export const metadata = publicPage(IMPORT_PATH, IMPORT_INDEX_TITLE, IMPORT_INDEX_DESCRIPTION)

export default function ImportIndexPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8 text-sm sm:text-base leading-relaxed text-slate-600 dark:text-slate-300">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(breadcrumbJsonLd(null)) }} />
      <ImportViewTracker slug="index" />
      <header className="space-y-3">
        <h1 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white">Import your rides</h1>
        <p>Connect or import, then see your rides, power profile and fitness. Pick where your rides live today.</p>
        <ImportCtaRow slug="index" placement="hero" />
      </header>
      <ul className="grid gap-4 sm:grid-cols-3">
        {IMPORT_GUIDES.map((g) => (
          <li key={g.slug} className="glass-dense rounded-2xl border border-slate-200 dark:border-surface-darkBorder bg-white dark:bg-surface-darkCard p-5">
            <h2 className="text-lg font-black text-slate-900 dark:text-white">
              <Link href={importGuidePath(g.slug)} className="hover:underline">{g.name}</Link>
            </h2>
            <p className="mt-2 text-sm">{guideBlurb(g)}</p>
          </li>
        ))}
      </ul>
      <p className="text-sm">
        Using an SRM? See the <Link className="font-semibold text-emerald-600 dark:text-brand-neon hover:underline" href="/import-help">SRM PC8 guide</Link>.
      </p>
    </div>
  )
}
