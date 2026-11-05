// Server-side reads of the anon-readable `tracks` table, limited to public fields.
import { supabase } from '../supabase'
import { fetchCountries, fetchDisciplines } from '../lookups'
import { withSlugs } from '../trackSlug'

const BASE_TRACK_FIELDS =
  'id, name, location, country_code, length_m, surface, is_indoor, elevation_m, latitude, longitude, notes, website_url, pricing_url, booking_url, created_at'

export const PUBLIC_TRACK_FIELDS =
  'id, name, location, country_code, length_m, surface, is_indoor, elevation_m, latitude, longitude, notes, website_url, pricing_url, booking_url, operator, year_built, phone, contact_is_organisational, opening_hours, opening_hours_spec, price_min, price_max, price_currency, operating_status, operating_status_checked_at, info_verified_at, created_at'

export async function loadPublicTracks() {
  try {
    let { data, error } = await supabase.from('tracks').select(PUBLIC_TRACK_FIELDS).order('name', { ascending: true })
    // Deploy-order safety: fall back to the base columns if the track-info migration is not live yet.
    if (error) ({ data, error } = await supabase.from('tracks').select(BASE_TRACK_FIELDS).order('name', { ascending: true }))
    if (error || !data) return []
    return withSlugs(data)
  } catch {
    return []
  }
}

export async function loadCountryNames() {
  try {
    const rows = await fetchCountries(supabase)
    return Object.fromEntries(rows.map((c) => [c.code, c.name]))
  } catch {
    return {}
  }
}

export const loadDisciplines = () => fetchDisciplines(supabase)
