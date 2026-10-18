'use client'

import { useState } from 'react'
import { gearInches, speedAtCadence, similarGears } from '../../lib/trackGearing'

// "Gear Architect" - migrated from v1's pages/20_gears.py. A simple, account-free calculator:
// given chainring/cog tooth counts, a target cadence and wheel size, derive gear inches, gear
// ratio and the resulting speed at that cadence.
export default function GearsPage() {
  const [chainring, setChainring] = useState(52)
  const [cog, setCog] = useState(14)
  const [cadence, setCadence] = useState(105)
  const [wheelSize, setWheelSize] = useState(27.0)
  const [tolerancePct, setTolerancePct] = useState(3)

  const safeCog = Number(cog) || 1
  const inches = gearInches(chainring, safeCog, wheelSize)
  const ratio = Number(chainring) / safeCog
  const speedKmh = speedAtCadence(inches, cadence)

  const similar = similarGears(chainring, safeCog, wheelSize, { tolerance: tolerancePct / 100 })

  const field = (label, value, onChange, step = 1) => (
    <label className="block space-y-1.5">
      <span className="text-xs uppercase font-bold text-slate-400">{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        className="w-full bg-slate-50 dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder rounded-xl px-3.5 py-2 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
      />
    </label>
  )

  const metric = (label, value, unit) => (
    <div className="glass-card bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm">
      <span className="text-xs uppercase font-bold text-slate-400">{label}</span>
      <div className="text-3xl font-black text-emerald-500 dark:text-brand-neon tracking-tight mt-1">
        {value}
        {unit && <span className="text-base font-bold text-slate-400 ml-1">{unit}</span>}
      </div>
    </div>
  )

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">Gear Architect</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Work out gear inches, ratio and speed at cadence for any chainring, cog and wheel combo.
        </p>
      </div>

      <div className="glass-card bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {field('Chainring (teeth)', chainring, setChainring, 1)}
          {field('Cog (teeth)', cog, setCog, 1)}
          {field('Cadence (RPM)', cadence, setCadence, 1)}
          {field('Wheel Size (in)', wheelSize, setWheelSize, 0.5)}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {metric('Your Gear', `${chainring || 0}x${cog || 0}`)}
        {metric('Gear Inches', inches.toFixed(1))}
        {metric('Ratio', ratio.toFixed(2))}
        {metric('Speed at Cadence', speedKmh.toFixed(1), 'km/h')}
      </div>

      <div className="glass-card bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm">
        <h2 className="text-sm font-extrabold text-slate-900 dark:text-white mb-3">Similar Gears</h2>
        <label className="block space-y-1.5 mb-4 max-w-xs">
          <span className="text-xs uppercase font-bold text-slate-400">Tolerance: ±{tolerancePct}%</span>
          <input
            type="range"
            min={1}
            max={10}
            step={0.5}
            value={tolerancePct}
            onChange={(e) => setTolerancePct(Number(e.target.value))}
            className="w-full accent-emerald-500"
          />
        </label>
        {similar.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No similar gears found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400">
                <th className="py-1">Gear</th>
                <th className="py-1">Gear Inches</th>
                <th className="py-1">Ratio</th>
                <th className="py-1">Speed (km/h)</th>
                <th className="py-1">Diff (in)</th>
              </tr>
            </thead>
            <tbody>
              {similar.map((g) => (
                <tr key={`${g.chainring}x${g.cog}`} className="border-t border-slate-100 dark:border-surface-darkBorder text-slate-900 dark:text-white">
                  <td className="py-1.5 font-bold">{g.chainring}x{g.cog}</td>
                  <td>{g.gearInches.toFixed(1)}</td>
                  <td>{g.ratio.toFixed(2)}</td>
                  <td>{speedAtCadence(g.gearInches, cadence).toFixed(1)}</td>
                  <td>{g.diff > 0 ? '+' : ''}{g.diff.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
