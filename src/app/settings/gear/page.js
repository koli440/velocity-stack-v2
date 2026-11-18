'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import SettingsShell, { SaveBar, settingsCard, settingsInput, settingsLabel } from '../../../components/SettingsShell'
import useSettingsProfile from '../../../components/useSettingsProfile'
import VelodromePicker from '../../../components/VelodromePicker'
import GearPicker from '../../../components/GearPicker'
import CoachBadge, { useCoachNames } from '../../../components/CoachBadge'
import { fetchTracks } from '../../../lib/lookups'
import { RIDE_TYPES, DEFAULT_RIDE_TYPE } from '../../../lib/rideType'
import { formFromRow } from '../../../lib/settingsProfile'

export default function SettingsGearPage() {
  const { user, row, loading, saving, saved, setSaved, save } = useSettingsProfile()
  const [tracks, setTracks] = useState([])
  const [homeTrackId, setHomeTrackId] = useState('')
  const [defaultChainring, setDefaultChainring] = useState('')
  const [defaultCog, setDefaultCog] = useState('')
  const [crankLength, setCrankLength] = useState('165.0')
  const [defaultRideType, setDefaultRideType] = useState(DEFAULT_RIDE_TYPE)
  const coachNames = useCoachNames(row ? [row] : [])

  useEffect(() => {
    fetchTracks(supabase).then(({ data }) => setTracks(data || []))
  }, [])

  useEffect(() => {
    if (!row) return
    const f = formFromRow(row)
    setHomeTrackId(f.homeTrackId)
    setDefaultChainring(f.defaultChainring)
    setDefaultCog(f.defaultCog)
    setCrankLength(f.crankLength)
    setDefaultRideType(f.defaultRideType)
  }, [row])

  const handleSave = (e) => {
    e.preventDefault()
    save('gear', { homeTrackId, defaultChainring, defaultCog, crankLength, defaultRideType })
  }

  return (
    <SettingsShell page="gear" title="Gear and defaults" description="Defaults applied to new rides, your gearing, crank length and home velodrome.">
      <form onSubmit={handleSave} className="space-y-6">
        <section className={`${settingsCard} space-y-4`}>
          <h2 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">Gear defaults <CoachBadge row={row} names={coachNames} /></h2>
          <div>
            <label className={settingsLabel}>Home Velodrome</label>
            <VelodromePicker tracks={tracks} value={homeTrackId} onChange={(v) => { setHomeTrackId(v); setSaved(false) }} favoriteId={null} emptyLabel="-- No Home Track --" compact />
          </div>

          <div className="max-w-xs">
            <label htmlFor="default-ride-type" className={settingsLabel}>Default ride type</label>
            <select
              id="default-ride-type"
              value={defaultRideType}
              onChange={(e) => { setDefaultRideType(e.target.value); setSaved(false) }}
              className={settingsInput}
            >
              {RIDE_TYPES.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
            <p className="mt-1 text-[10px] text-slate-400">Applied to new imports and uploads. You can change a ride&apos;s type later.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <GearPicker
              label="Default gear (optional)"
              chainring={defaultChainring}
              cog={defaultCog}
              onChange={(g) => { setDefaultChainring(g.chainring); setDefaultCog(g.cog); setSaved(false) }}
              showStats
              className="sm:col-span-2"
            />

            <div>
              <label className={settingsLabel}>Crank (mm)</label>
              <input
                type="number"
                step="0.5"
                value={crankLength}
                onChange={(e) => { setCrankLength(e.target.value); setSaved(false) }}
                className={settingsInput}
              />
            </div>
          </div>
        </section>

        <SaveBar saving={saving} disabled={loading || !user} saved={saved} />
      </form>
    </SettingsShell>
  )
}
