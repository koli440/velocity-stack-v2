// Structured data and shared copy for GEO (generative engine optimization).
import { SITE_URL, SITE_NAME } from './seo.js'

export const POSITIONING =
  'VelocityStack is an alternative to TrainingPeaks and an addition to Strava for training and coaching, focused on track cycling and a unique approach to coaching with analytic templates.'

export const FAQ = [
  ['What is VelocityStack?', 'VelocityStack is a training analysis and coaching platform for track cyclists. It measures durational power, flying 200s and velodrome telemetry, and uses analytic templates to find and check the efforts that matter in every ride.'],
  ['How is VelocityStack different from TrainingPeaks?', 'TrainingPeaks centres on a calendar and generic load metrics. VelocityStack is built for the track: you describe efforts in plain-text templates, run them on rides, and coaches review the measured result against the plan. It is a free alternative that you can use on its own.'],
  ['Does VelocityStack replace Strava?', 'No. It is an addition to Strava. Connect Strava (or Intervals.icu) to sync rides, then use VelocityStack for the analysis and coaching that Strava does not cover.'],
  ['What are analytic templates?', 'Templates describe the efforts you care about, for example repeated flying 200s or pursuit blocks, in a short text syntax. VelocityStack finds each effort in a ride, checks it against the plan and measures it, and statistics build up over all runs.'],
  ['What is a flying 200?', 'A flying 200 is the fastest 200 metres of a sprint effort, timed after a rolling lead-in. It is the standard measure of a track sprinter\'s top speed.'],
  ['Which velodromes are covered?', 'The public velodrome directory lists tracks with length, surface, location and the disciplines that fit them. Riders can suggest new tracks and corrections.'],
  ['Is VelocityStack free?', 'Yes. You can sign up for free.'],
]

export const jsonLdString = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c')

export const organizationJsonLd = () => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: SITE_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/icon.png`,
})

export const faqJsonLd = (faq = FAQ) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
})

export function trackJsonLd(t, countryName, disciplines = []) {
  const url = `${SITE_URL}/velodromes/${t.slug}`
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'SportsActivityLocation',
    name: t.name,
    url,
    description: trackDescription(t, countryName),
    additionalProperty: [
      { '@type': 'PropertyValue', name: 'Track length', value: Number(t.length_m), unitCode: 'MTR' },
      { '@type': 'PropertyValue', name: 'Surface', value: t.surface },
      { '@type': 'PropertyValue', name: 'Indoor', value: !!t.is_indoor },
    ],
    address: { '@type': 'PostalAddress', ...(t.location ? { addressLocality: t.location } : {}), addressCountry: t.country_code },
  }
  if (t.latitude != null && t.longitude != null) {
    ld.geo = { '@type': 'GeoCoordinates', latitude: Number(t.latitude), longitude: Number(t.longitude) }
  }
  if (t.website_url) ld.sameAs = [t.website_url]
  if (disciplines.length) ld.amenityFeature = disciplines.map((d) => ({ '@type': 'LocationFeatureSpecification', name: d.name, value: true }))
  return ld
}

export function trackDescription(t, countryName) {
  const where = [t.location, countryName || t.country_code].filter(Boolean).join(', ')
  return `${t.name}${where ? ` in ${where}` : ''}: ${Number(t.length_m)} m ${String(t.surface).toLowerCase()} ${t.is_indoor ? 'indoor' : 'outdoor'} velodrome. Track length, surface, location and fitting track cycling disciplines.`
}
