import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SITE_URL } from '../../../lib/seo'
import { isIndexableTrack } from '../../../lib/trackSlug'
import { disciplineFitsTrack } from '../../../lib/lookups'
import { trackJsonLd, trackDescription, jsonLdString } from '../../../lib/geo'
import { loadPublicTracks, loadCountryNames, loadDisciplines } from '../../../lib/server/publicTracks'

export const revalidate = 3600

export async function generateStaticParams() {
  return (await loadPublicTracks()).map((t) => ({ slug: t.slug }))
}

async function find(slug) {
  const tracks = await loadPublicTracks()
  return tracks.find((t) => t.slug === slug) || null
}

export async function generateMetadata({ params }) {
  const { slug } = await params
  const t = await find(slug)
  if (!t) return { title: 'Velodrome not found', robots: { index: false, follow: false } }
  const countries = await loadCountryNames()
  const country = countries[t.country_code] || t.country_code
  const title = `${t.name}${country ? ` (${country})` : ''} velodrome: length, surface, location`
  const description = trackDescription(t, country)
  const path = `/velodromes/${t.slug}`
  return {
    title,
    description,
    alternates: { canonical: path },
    ...(isIndexableTrack(t) ? {} : { robots: { index: false, follow: true } }),
    openGraph: { type: 'website', title, description, url: path },
  }
}

const Row = ({ label, children }) => (
  <div>
    <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</dt>
    <dd className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">{children}</dd>
  </div>
)

export default async function TrackPage({ params }) {
  const { slug } = await params
  const t = await find(slug)
  if (!t) notFound()
  const [countries, disciplines] = await Promise.all([loadCountryNames(), loadDisciplines()])
  const country = countries[t.country_code] || t.country_code
  const fitting = disciplines.filter((d) => disciplineFitsTrack(d, Number(t.length_m)))
  const indexable = isIndexableTrack(t)

  return (
    <article className="max-w-3xl mx-auto space-y-6">
      {indexable && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(trackJsonLd(t, country, fitting)) }} />
      )}
      <nav className="text-xs text-slate-500">
        <Link href="/velodromes" className="font-semibold text-emerald-600 dark:text-brand-neon hover:underline">Velodromes</Link>
      </nav>
      <h1 className="text-3xl font-black text-slate-900 dark:text-white">{t.name} velodrome</h1>
      <p className="text-sm text-slate-600 dark:text-slate-300">{trackDescription(t, country)}</p>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 rounded-2xl border border-slate-200 dark:border-surface-darkBorder bg-white dark:bg-surface-darkCard p-5">
        <Row label="Track length">{t.length_m ? `${Number(t.length_m)} m` : 'Unknown'}</Row>
        <Row label="Surface">{t.surface || 'Unknown'}</Row>
        <Row label="Type">{t.is_indoor ? 'Indoor' : 'Outdoor'}</Row>
        <Row label="Country">{country || 'Unknown'}</Row>
        {t.location && <Row label="Location">{t.location}</Row>}
        {t.elevation_m != null && <Row label="Elevation">{Number(t.elevation_m)} m</Row>}
        {t.latitude != null && t.longitude != null && (
          <Row label="Coordinates">{Number(t.latitude).toFixed(4)}, {Number(t.longitude).toFixed(4)}</Row>
        )}
      </dl>
      {t.notes && <p className="text-sm italic text-slate-500">{t.notes}</p>}
      {fitting.length > 0 && (
        <section>
          <h2 className="text-lg font-black text-slate-900 dark:text-white mb-2">Disciplines that fit this track</h2>
          <p className="text-xs text-slate-500 mb-2">Events whose distance rules allow a {Number(t.length_m)} m track.</p>
          <ul className="flex flex-wrap gap-2">
            {fitting.map((d) => (
              <li key={d.id} className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">{d.name}</li>
            ))}
          </ul>
        </section>
      )}
      <div className="flex flex-wrap gap-4 text-sm">
        {[['website_url', 'Website'], ['pricing_url', 'Pricing'], ['booking_url', 'Book a session']].map(([k, label]) =>
          t[k] ? <a key={k} href={t[k]} target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald-600 dark:text-brand-neon underline">{label}</a> : null,
        )}
      </div>
      <p className="text-sm text-slate-500">
        Analyse your own rides on this track with <Link href="/how-it-works" className="font-semibold text-emerald-600 dark:text-brand-neon hover:underline">VelocityStack</Link>.
        Canonical page: {SITE_URL}/velodromes/{t.slug}
      </p>
    </article>
  )
}
