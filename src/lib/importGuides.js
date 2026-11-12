// Content and helpers for the public "import your rides" landing pages (/import, /import/strava, /import/garmin, /import/fit).
// Pure data, no DOM. Source names/blurbs come from RIDE_SOURCES; see docs/import-pages.md.
import { SITE_URL, SITE_NAME, fitTitle, fitDescription } from './seo.js'
import { rideSourceById, CONNECTIONS_PATH } from './rideSources.js'

export const IMPORT_PATH = '/import'
export const isImportPath = (pathname) => pathname === IMPORT_PATH || String(pathname || '').startsWith(`${IMPORT_PATH}/`)

export const importGuidePath = (slug) => `${IMPORT_PATH}/${slug}`

const FIT_NOTE = 'Rides you already imported are skipped, so importing the same file twice is safe.'

export const IMPORT_GUIDES = [
  {
    slug: 'strava',
    sourceId: 'strava',
    name: 'Strava',
    heading: 'Import your Strava rides',
    title: 'Import Strava Rides and Export Your Strava Data',
    description:
      'Link Strava to VelocityStack or export your Strava data as a ZIP and import it in bulk. Step-by-step guide, including the full-history fallback.',
    intro:
      'Two ways to bring your Strava rides in: connect your account, or request your Strava data export (a ZIP archive) and import it. The export is the best route for your complete history.',
    sections: [
      {
        id: 'connect',
        title: 'Option 1: connect Strava',
        steps: [
          'Create a free VelocityStack account (or sign in).',
          'Open Connections and choose Connect Strava, then allow access to your activities.',
          'Your newest rides arrive first and the rest of your history follows in the background.',
        ],
        note: 'Strava limits how much its API may be read, and that budget is shared by every rider. Long histories can take a while to arrive, which is why the export below is the better route for years of rides.',
      },
      {
        id: 'export',
        title: 'Option 2: export your Strava data and import the ZIP',
        steps: [
          'On the Strava website open Settings, then My Account, then Download or Delete Your Account, and choose Get Started under Download Request.',
          'Request your archive. Strava emails you a link, usually within a few hours; download the ZIP.',
          'In VelocityStack choose Add session, then Import History, and select the ZIP as it is (no need to unzip it).',
          'VelocityStack reads the .fit and .fit.gz files inside the archive and skips everything else. ' + FIT_NOTE,
        ],
        note: 'Rides in the archive that only exist as .gpx or .tcx files (typically rides recorded with the Strava app instead of a device) are not imported. Use Connect Strava for those.',
      },
    ],
    faq: [
      ['How do I export my Strava data?', 'On strava.com go to Settings, My Account, Download or Delete Your Account, then request your archive. Strava emails a ZIP with your activities. In VelocityStack, use Add session, Import History and select that ZIP.'],
      ['Why is there a ZIP import if I can connect Strava?', 'Strava limits how much its API may be read, and the limit is shared across all riders. Connecting works well for new rides, but the data export is the quickest way to bring in a long history.'],
      ['Do I need to unzip the Strava export?', 'No. Select the ZIP itself in Import History. VelocityStack opens it in your browser and imports the .fit and .fit.gz files inside.'],
      ['Will importing the same rides twice create duplicates?', 'No. Rides you already imported are recognised and skipped.'],
      ['Is VelocityStack a Strava alternative?', 'It is built for a different job: power, cadence and speed analysis for track and road riders, with interval templates, a PB Vault and coaching. Many riders keep Strava for social and use VelocityStack for analysis.'],
    ],
    related: ['garmin', 'fit'],
  },
  {
    slug: 'garmin',
    sourceId: 'garmin',
    name: 'Garmin',
    heading: 'Import your Garmin rides',
    title: 'Import Garmin Rides and FIT Files',
    description:
      'Connect Garmin Connect to VelocityStack for automatic ride sync, and import older rides from a Garmin data export. Step-by-step guide.',
    intro:
      'Connect Garmin and new rides arrive automatically, straight from Garmin Connect. Garmin only sends activities recorded after you connect, so bring older rides in from your Garmin data export.',
    sections: [
      {
        id: 'connect',
        title: 'Connect Garmin for new rides',
        steps: [
          'Create a free VelocityStack account (or sign in).',
          'Open Connections and choose Connect Garmin, then approve access on Garmin Connect.',
          'Rides you record from now on are imported automatically.',
        ],
      },
      {
        id: 'export',
        title: 'Import your older Garmin rides',
        steps: [
          'On Garmin, open your account data management page and choose Export Your Data. Garmin emails you a download link.',
          'Download the ZIP. Your rides are inside as .fit.gz files; you do not need to unzip anything.',
          'In VelocityStack choose Add session, then Import History, and select the ZIP. ' + FIT_NOTE,
        ],
      },
    ],
    faq: [
      ['How do I link my Garmin to VelocityStack?', 'Open Connections, choose Connect Garmin and approve access on Garmin Connect. New rides then sync automatically.'],
      ['Why are my older Garmin rides missing?', 'Garmin only sends activities recorded after you connect. Import older rides from your Garmin data export or from .fit files with Import History.'],
      ['Can I import Garmin .fit files directly?', 'Yes. Copy .fit files from the device (or download them from Garmin Connect) and select them in Import History. A ZIP of .fit or .fit.gz files works too.'],
      ['Does the VelocityStack Garmin connection send workouts to my device?', 'Yes, planned workouts can be sent to your Garmin device once connected.'],
    ],
    related: ['fit', 'strava'],
  },
  {
    slug: 'fit',
    sourceId: null,
    name: '.fit files',
    heading: 'Import .fit files',
    title: 'Import FIT Files: Bulk Upload Your Rides',
    description:
      'Import .fit files from any bike computer: single files, many at once, or a ZIP. Includes how to copy rides off an SRM, Wahoo or Garmin.',
    intro:
      'Any .fit file works, whichever device recorded it. Import one ride, a whole folder, or a ZIP archive of your history.',
    sections: [
      {
        id: 'import',
        title: 'Import your files',
        steps: [
          'Create a free VelocityStack account (or sign in).',
          'Choose Add session, then Upload .fit for a single ride or Import History for many files or a ZIP.',
          'Pick the velodrome and your gear if the ride was indoors on a track: there is usually no GPS, so speed and distance are worked out from cadence and gear. ' + FIT_NOTE,
        ],
      },
      {
        id: 'devices',
        title: 'Getting files off your device',
        steps: [
          'Garmin and Wahoo: download the .fit files from the device over USB, or from the Garmin Connect / Wahoo apps.',
          'SRM PowerControl 8: connect it by USB and copy the files from SRM/Activities. The SRM guide has the details.',
          'Anything else: export as .fit from the vendor software first, then import that file.',
        ],
        note: 'Copy files off a head unit; never delete folders on it or format it.',
      },
    ],
    faq: [
      ['What is a .fit file?', 'FIT is the standard activity file format used by Garmin, Wahoo, SRM and many other bike computers. It stores power, heart rate, cadence and speed for every second of a ride.'],
      ['Can I import many .fit files at once?', 'Yes. Select several files, or one ZIP, in Import History. Rides you already imported are skipped.'],
      ['Are .gpx and .tcx files supported?', 'No. Only .fit files (plain or gzip-compressed, also inside a ZIP) are imported.'],
      ['How do I get .fit files off an SRM?', 'Copy them from the SRM/Activities folder of the PC8 over USB. The SRM import guide has the full steps for older units too.'],
    ],
    related: ['garmin', 'strava'],
  },
]

export const guideBySlug = (slug) => IMPORT_GUIDES.find((g) => g.slug === slug) || null
export const IMPORT_SLUGS = IMPORT_GUIDES.map((g) => g.slug)
export const IMPORT_PATHS = [IMPORT_PATH, ...IMPORT_SLUGS.map(importGuidePath)]

export const IMPORT_INDEX_TITLE = 'Import Your Rides: Strava, Garmin and FIT'
export const IMPORT_INDEX_DESCRIPTION =
  'Bring your rides into VelocityStack from Strava, Garmin or any .fit file, then see your power profile and fitness. Choose your source and follow the guide.'

/** Page <title> (before the layout suffix) and description, trimmed to the SEO limits. */
export const guideTitle = (g) => fitTitle(g.title)
export const guideDescription = (g) => fitDescription(g.description)

export function faqJsonLd(faq) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  }
}

export function howToJsonLd(g) {
  const steps = g.sections.flatMap((s) => s.steps)
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: g.heading,
    description: g.description,
    step: steps.map((text, i) => ({ '@type': 'HowToStep', position: i + 1, text })),
  }
}

export function breadcrumbJsonLd(g) {
  const items = [['Import', IMPORT_PATH], ...(g ? [[g.name, importGuidePath(g.slug)]] : [])]
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: SITE_NAME, item: SITE_URL },
      ...items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 2, name, item: `${SITE_URL}${path}` })),
    ],
  }
}

/** Blurb for the index card: the RIDE_SOURCES blurb when the guide is for a registered source. */
export function guideBlurb(g) {
  return (g.sourceId && rideSourceById(g.sourceId)?.blurb) || g.intro
}

export const IMPORT_EVENTS = Object.freeze(['import_guide_view', 'import_cta_click'])

/** GA4 params for an import-page event, or null when the event or guide is unknown. */
export function importEventParams(event, slug, cta) {
  if (!IMPORT_EVENTS.includes(event)) return null
  if (slug !== 'index' && !guideBySlug(slug)) return null
  return { source_guide: slug, ...(cta ? { cta: String(cta).slice(0, 40) } : {}) }
}
