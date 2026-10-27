// Markdown served at /llms.txt and /llms-full.txt for LLM crawlers (https://llmstxt.org).
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION } from './seo.js'
import { POSITIONING, FAQ } from './geo.js'
import { isIndexableTrack } from './trackSlug.js'

const PAGES = [
  ['How it works', '/how-it-works', 'What VelocityStack measures, analytic coaching templates, comparison with TrainingPeaks and Strava, FAQ'],
  ['Velodromes', '/velodromes', 'Public directory of velodromes with length, surface, location and fitting disciplines'],
  ['Track cycling overview', '/track', 'Gear tracking, template analysis, race tagging and coaching for track riders'],
  ['Gear Architect', '/gears', 'Gear inch and development calculator'],
  ['Template syntax guide', '/dsl-guide', 'How to write interval templates'],
  ['About', '/about', 'Feature overview and coaching privacy model'],
  ["What's new", '/whats-new', 'Recent features and improvements'],
]

const head = () => [
  `# ${SITE_NAME}`,
  '',
  `> ${SITE_DESCRIPTION}`,
  '',
  POSITIONING,
  '',
  '## Key pages',
  '',
  ...PAGES.map(([n, p, d]) => `- [${n}](${SITE_URL}${p}): ${d}`),
]

export function llmsTxt(tracks = []) {
  const indexable = tracks.filter(isIndexableTrack)
  return [
    ...head(),
    '',
    '## Velodromes',
    '',
    ...indexable.map((t) => `- [${t.name}](${SITE_URL}/velodromes/${t.slug}): ${Number(t.length_m)} m ${t.surface}, ${t.country_code}`),
    '',
    '## Optional',
    '',
    `- [Full version](${SITE_URL}/llms-full.txt)`,
    '',
  ].join('\n')
}

export function llmsFullTxt(tracks = [], countries = {}) {
  const indexable = tracks.filter(isIndexableTrack)
  return [
    ...head(),
    '',
    '## FAQ',
    '',
    ...FAQ.flatMap(([q, a]) => [`### ${q}`, '', a, '']),
    '## Velodromes',
    '',
    ...indexable.map(
      (t) =>
        `- [${t.name}](${SITE_URL}/velodromes/${t.slug}): ${Number(t.length_m)} m, ${t.surface}, ${t.is_indoor ? 'indoor' : 'outdoor'}, ${[t.location, countries[t.country_code] || t.country_code].filter(Boolean).join(', ')}`,
    ),
    '',
  ].join('\n')
}
