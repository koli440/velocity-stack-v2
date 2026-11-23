// Shared constants for the public /coaching and /analysis-templates pages.
// Everything is free for now (riders and coaches); keep copy and JSON-LD offers consistent.
import { SITE_URL, SITE_NAME } from './seo.js'
import { ALL_SYSTEM_TEMPLATES } from './systemTemplates.js'

export const COACHING_PATH = '/coaching'
export const COACHING_TITLE = 'Track cycling coaching platform, free'
export const COACHING_DESCRIPTION =
  'Free coaching for track cyclists: coach athletes with their consent, review rides with analytic templates and plan workouts. Riders stay in control.'

export const TEMPLATES_PATH = '/analysis-templates'
export const TEMPLATES_TITLE = 'Cycling analysis templates: examples'
export const TEMPLATES_DESCRIPTION =
  'Free gallery of cycling analysis templates with syntax: pursuit, flying 200, threshold, over-unders and more. Describe a session once and find every rep.'

// Real catalogue entries (src/lib/systemTemplates.js), shown with their exact DSL.
export const GALLERY_SLUGS = [
  'sys_track_flying_200',
  'sys_track_repeated_flying_200s',
  'sys_track_pursuit_4km',
  'sys_track_kilo',
  'sys_road_threshold_2x20',
  'sys_road_vo2max_5x4',
  'sys_lt_over_unders',
  'sys_wkg_threshold_2x20',
  'sys_zone_tempo_3x15',
]

export const galleryTemplates = () =>
  GALLERY_SLUGS.map((slug) => ALL_SYSTEM_TEMPLATES.find((t) => t.slug === slug)).filter(Boolean)

const FREE_OFFER = { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock' }

export function pageJsonLd({ path, name, description, featureList, audienceType, pageType = 'WebPage' }) {
  const url = `${SITE_URL}${path}`
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': pageType,
        '@id': `${url}#page`,
        url,
        name,
        description,
        isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE_URL },
        about: { '@id': `${SITE_URL}#app` },
      },
      {
        '@type': 'WebApplication',
        '@id': `${SITE_URL}#app`,
        name: SITE_NAME,
        url: SITE_URL,
        applicationCategory: 'SportsApplication',
        operatingSystem: 'Any',
        isAccessibleForFree: true,
        offers: FREE_OFFER,
        featureList,
        audience: { '@type': 'Audience', audienceType },
      },
    ],
  }
}

export const coachingJsonLd = () =>
  pageJsonLd({
    path: COACHING_PATH,
    name: COACHING_TITLE,
    description: COACHING_DESCRIPTION,
    audienceType: 'Track cyclists and cycling coaches',
    featureList: [
      'Coaching relationships that start only when the rider accepts',
      'Coach view of athlete activities, templates, fitness and calendar',
      'Analytic templates run on athlete rides',
      'Planned workouts, races and notes on the athlete calendar',
    ],
  })

export const templatesJsonLd = () => {
  const ld = pageJsonLd({
    path: TEMPLATES_PATH,
    name: TEMPLATES_TITLE,
    description: TEMPLATES_DESCRIPTION,
    audienceType: 'Cyclists and cycling coaches',
    pageType: 'CollectionPage',
    featureList: [
      'Plain-text analysis templates for intervals, pursuits and sprints',
      'Power, heart rate, cadence, speed, W/kg, lactate threshold and zone bands',
      'Time-keyed and distance-keyed steps',
    ],
  })
  ld['@graph'][0].mainEntity = {
    '@type': 'ItemList',
    itemListElement: galleryTemplates().map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, description: t.description })),
  }
  return ld
}
