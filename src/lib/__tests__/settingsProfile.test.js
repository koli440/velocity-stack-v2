import test from 'node:test'
import assert from 'node:assert/strict'
import { formFromRow, buildProfileUpdate, legacySettingsRedirect, settingsCrumbs, SETTINGS_PAGES } from '../settingsProfile.js'

test('each section saves only its own columns', () => {
  const f = formFromRow({ first_name: ' Ann ', birth_year: 1990, default_chainring: 50, default_cog: 15 })
  const profile = buildProfileUpdate('profile', f).updates
  assert.deepEqual(Object.keys(profile).sort(), ['birth_year', 'first_name', 'last_name', 'nickname'])
  assert.equal(profile.first_name, 'Ann')
  assert.equal(profile.birth_year, 1990)
  const prefs = buildProfileUpdate('preferences', f).updates
  assert.equal(Object.keys(prefs).length, 5)
  const gear = buildProfileUpdate('gear', f).updates
  assert.deepEqual(Object.keys(gear).sort(), ['crank_length_mm', 'default_chainring', 'default_cog', 'default_ride_type', 'home_track_id'])
  assert.equal(gear.crank_length_mm, 165)
})

test('invalid gear is reported and birth year validated', () => {
  const f = { ...formFromRow(null), defaultChainring: '2', defaultCog: '15' }
  assert.ok(buildProfileUpdate('gear', f).error)
  assert.equal(buildProfileUpdate('profile', { ...formFromRow(null), birthYear: '12' }).updates.birth_year, null)
  assert.ok(buildProfileUpdate('nope', f).error)
})

test('legacy hashes map to the new pages', () => {
  assert.equal(legacySettingsRedirect('#coaching'), '/settings/coaching#coaching')
  assert.equal(legacySettingsRedirect('#onboarding'), '/settings/coaching#onboarding')
  assert.equal(legacySettingsRedirect('#physiology'), '/settings/physiology#physiology')
  assert.equal(legacySettingsRedirect(''), null)
})

test('breadcrumbs and page list', () => {
  assert.deepEqual(settingsCrumbs('preferences'), [{ label: 'Settings', href: '/settings' }, { label: 'Preferences' }])
  assert.equal(SETTINGS_PAGES.length, 7)
})
