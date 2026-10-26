'use client'

// Whole-run verdict and per-effort (rep) analysis of one template run versus a chosen reference (issue #283).
// All numbers come from the pure helpers in lib/templateComparison.js; runs stored before the per-effort fields
// existed are analysed from their efforts[], so nothing here requires new data.

import { useMemo } from 'react'
import Icon from './Icon'
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatDate } from '../lib/dateFormat'
import {
  REFERENCE_LABELS,
  REFERENCE_MODES,
  analyzeRun,
  formatDiff,
  formatHeadline,
  matchReps,
  ridden,
  trendSeries,
  verdict as computeVerdict,
} from '../lib/templateComparison'

const VERDICT_STYLE = {
  better: { text: 'Better', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30', icon: 'chevronUp' },
  similar: { text: 'Similar', cls: 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/20', icon: null },
  worse: { text: 'Worse', cls: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30', icon: 'chevronDown' },
}

const ORANGE = '#f97316'
const GHOST = '#94a3b8'

function Stat({ label, value, hint, tone }) {
  return (
    <div className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 min-w-[7rem]">
      <div className="text-[9px] uppercase font-bold text-slate-400">{label}</div>
      <div className={`text-sm font-black ${tone || 'text-slate-900 dark:text-white'}`}>{value}</div>
      {hint && <div className="text-[10px] text-slate-400">{hint}</div>}
    </div>
  )
}

const signed = (v, suffix = '%') => (typeof v === 'number' ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}${suffix}` : '—')
const goodTone = (good) => (good == null ? '' : good ? 'text-emerald-500' : 'text-red-500')

export function ReferenceSelect({ pref, onChange, candidates, metric, id }) {
  const field =
    'bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-2 py-1.5 text-[11px] text-slate-900 dark:text-white font-semibold max-w-full'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={`${id}-ref`} className="text-[10px] font-black uppercase tracking-wider text-slate-400">
        Compare with
      </label>
      <select id={`${id}-ref`} value={pref.mode} onChange={(e) => onChange({ mode: e.target.value, customId: pref.customId })} className={field}>
        {REFERENCE_MODES.map((m) => (
          <option key={m} value={m}>
            {REFERENCE_LABELS[m]}
          </option>
        ))}
      </select>
      {pref.mode === 'custom' && (
        <select
          aria-label="Choose the run to compare with"
          value={pref.customId || ''}
          onChange={(e) => onChange({ mode: 'custom', customId: e.target.value || null })}
          className={field}
        >
          <option value="">Pick a run…</option>
          {candidates.map((h) => {
            const act = Array.isArray(h.activities) ? h.activities[0] : h.activities
            return (
              <option key={h.id} value={h.id}>
                {formatDate(act?.activity_date || h.created_at)} · {act?.title || 'Session'} · {formatHeadline(metric, h.__headline)}
              </option>
            )
          })}
        </select>
      )}
    </div>
  )
}

function RepChart({ analysis, reference, match, mode }) {
  const { metric, fade } = analysis
  const data = useMemo(() => {
    const refVals = [...(reference?.reps || new Map())]
    const lower = metric.lowerBetter
    const refBest = refVals.length ? (lower ? Math.min(...refVals.map(([, v]) => v)) : Math.max(...refVals.map(([, v]) => v))) : null
    const pctOf = (v, best) => (best ? Math.round((lower ? best / v : v / best) * 1000) / 10 : null)
    const reps = new Set([...analysis.reps.keys(), ...(reference?.reps?.keys() || [])])
    return [...reps]
      .sort((a, b) => a - b)
      .map((rep) => {
        const v = analysis.reps.get(rep)
        const r = reference?.reps?.get(rep)
        const curBest = fade ? fade.curve.reduce((a, c) => (lower ? Math.min(a, c.value) : Math.max(a, c.value)), lower ? Infinity : -Infinity) : null
        return {
          rep,
          run: mode === 'pct' ? (v != null ? pctOf(v, curBest) : null) : v ?? null,
          ghost: mode === 'pct' ? (r != null ? pctOf(r, refBest) : null) : r ?? null,
        }
      })
  }, [analysis, reference, mode, metric, fade])
  const fmt = (v) => (mode === 'pct' ? `${v}%` : formatHeadline(metric, v))
  return (
    <div className="h-48" role="img" aria-label={`Rep by rep ${metric.label} chart${reference ? ' with the reference as a dashed ghost line' : ''}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
          <XAxis dataKey="rep" tick={{ fontSize: 10 }} label={{ value: 'Rep', position: 'insideBottomRight', offset: -2, fontSize: 9 }} />
          <YAxis width={44} tick={{ fontSize: 10 }} domain={['auto', 'auto']} reversed={mode !== 'pct' && metric.lowerBetter} tickFormatter={(v) => (mode === 'pct' ? `${v}%` : metric.id === 'time' ? formatHeadline(metric, v) : v)} />
          <Tooltip formatter={(v, name) => [fmt(v), name]} labelFormatter={(l) => `Rep ${l}`} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          {mode === 'pct' && <ReferenceLine y={100} stroke={GHOST} strokeOpacity={0.4} />}
          {reference && match.common.length > 0 && <Line type="monotone" dataKey="ghost" name={reference.label} stroke={GHOST} strokeDasharray="5 4" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />}
          <Line type="monotone" dataKey="run" name="This run" stroke={ORANGE} strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function TrendChart({ history, metric, currentId }) {
  const points = useMemo(() => trendSeries(history, metric), [history, metric])
  if (points.length < 2) return <p className="text-[11px] text-slate-400">Not enough runs for a trend yet.</p>
  const data = points.map((p) => ({ ...p, label: formatDate(new Date(p.date).toISOString()), current: p.id === currentId ? p.value : null }))
  return (
    <div className="h-44" role="img" aria-label={`${metric.label} over all runs of this template`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
          <XAxis dataKey="label" tick={{ fontSize: 9 }} />
          <YAxis width={44} tick={{ fontSize: 10 }} domain={['auto', 'auto']} reversed={metric.lowerBetter} tickFormatter={(v) => (metric.id === 'time' ? formatHeadline(metric, v) : v)} />
          <Tooltip formatter={(v, name) => [formatHeadline(metric, v), name]} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Line type="monotone" dataKey="best" name="Best so far" stroke={GHOST} strokeDasharray="5 4" dot={false} />
          <Line type="monotone" dataKey="value" name={metric.label} stroke={ORANGE} strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="current" name="This run" stroke="#0ea5e9" strokeWidth={0} dot={{ r: 6 }} legendType="circle" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/**
 * @param {object} props
 * @param {object} props.run the run being viewed
 * @param {object[]} props.history executions of the same template
 * @param {object|null} props.reference result of selectReference (null: nothing to compare with)
 * @param {object} props.analysis result of analyzeRun for `run`
 */
export default function TemplateRunAnalysis({ run, history, reference, analysis, pref, onPrefChange, candidates, chartMode, onChartModeChange }) {
  const { metric } = analysis
  if (!metric) return null
  const id = `ra-${run.id}`
  const v = reference ? computeVerdict(analysis.headline, reference.headline, metric) : null
  const style = v ? VERDICT_STYLE[v.verdict] : null
  const match = matchReps(analysis.reps, reference?.reps, metric)
  const { fade, flags, completeness: comp, hrRecovery } = analysis
  const repCount = analysis.reps.size
  const mix = [...analysis.reps.values()].length

  return (
    <section aria-label="Rep analysis" className="space-y-3 rounded-2xl bg-slate-50/60 dark:bg-slate-900/30 border border-slate-200/80 dark:border-slate-800 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ReferenceSelect id={id} pref={pref} onChange={onPrefChange} candidates={candidates} metric={metric} />
        {comp && (
          <span
            className={`text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-lg border ${comp.complete === false ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30' : 'bg-slate-500/10 text-slate-500 border-slate-500/20'}`}
            data-testid="completeness"
          >
            {comp.complete === false && <><Icon name="alert" />{' '}</>}
            {comp.text}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-stretch gap-2" aria-live="polite">
        {style ? (
          <div className={`px-3 py-2 rounded-xl border ${style.cls} min-w-[9rem]`} data-testid="verdict">
            <div className="text-[9px] uppercase font-bold opacity-70">vs {reference.label.toLowerCase()}</div>
            <div className="text-sm font-black">
              <span aria-hidden="true">{style.icon ? <Icon name={style.icon} /> : '＝'} </span>
              {style.text} than reference
            </div>
            <div className="text-[10px] font-bold">
              {formatHeadline(metric, analysis.headline)} · {formatDiff(metric, v.diff)} ({signed(v.pct)})
            </div>
          </div>
        ) : (
          <div className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-[11px] text-slate-400 min-w-[9rem]">
            {reference === null ? 'No earlier run to compare with yet.' : ''}
            <div className="font-black text-slate-700 dark:text-slate-200">{formatHeadline(metric, analysis.headline)}</div>
          </div>
        )}
        <Stat label={metric.label} value={formatHeadline(metric, analysis.headline)} hint={metric.lowerBetter ? 'lower is better' : null} />
        {fade && (
          <>
            <Stat label="1st vs 2nd half" value={signed(fade.halfDeltaPct)} tone={goodTone(fade.halfFadePct <= 0)} hint={`${formatHeadline(metric, fade.firstHalfAvg)} → ${formatHeadline(metric, fade.secondHalfAvg)}`} />
            <Stat label="Worst rep" value={`#${fade.worst.rep}`} hint={`index ${fade.worst.index} of ${fade.n}, ${fade.worst.pctBelowBest}% off best`} />
            <Stat label="Fade slope" value={`${signed(-fade.slopePctPerRep)}/rep`} tone={goodTone(fade.slopePctPerRep <= 0)} hint="% of mean per rep" />
            <Stat label="Consistency" value={`${fade.consistency}`} hint={`CV ${fade.cvPct}%`} />
          </>
        )}
      </div>
      {reference?.fellBack && <p className="text-[10px] text-slate-400">The chosen run is not available, comparing with the previous run instead.</p>}
      {reference && reference.mode === 'median5' && <p className="text-[10px] text-slate-400">Median of the {reference.count} most recent earlier run{reference.count === 1 ? '' : 's'} (no date window).</p>}

      {flags.length > 0 && (
        <ul className="space-y-1" aria-label="Rep flags">
          {flags.map((f) => (
            <li key={`${f.type}-${f.rep}`} className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
              <Icon name="alert" />{' '}
              {f.text}
            </li>
          ))}
        </ul>
      )}

      {repCount > 0 && (
        <div className="space-y-2">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] min-w-[26rem]">
              <caption className="sr-only">Rep by rep {metric.label} with the delta against the reference and against rep 1</caption>
              <thead className="text-slate-400 text-left uppercase text-[9px]">
                <tr>
                  <th scope="col" className="py-1 pr-3">Rep</th>
                  <th scope="col" className="pr-3">This run</th>
                  {reference && <th scope="col" className="pr-3">Reference</th>}
                  {reference && <th scope="col" className="pr-3">Δ vs ref</th>}
                  <th scope="col" className="pr-3">Δ vs rep 1</th>
                  {hrRecovery && <th scope="col" className="pr-3">HR rec. {hrRecovery.windowSec}s</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {match.rows.map((r) => {
                  const flagged = flags.some((f) => f.type === 'low' && f.rep === r.rep)
                  const hr = hrRecovery?.values.find((x) => x.rep === r.rep)
                  return (
                    <tr key={r.rep} className={flagged ? 'bg-amber-500/10' : ''}>
                      <th scope="row" className="py-1 pr-3 font-black">{r.rep}{flagged && <>{' '}<Icon name="alert" /></>}</th>
                      <td className="pr-3 font-mono font-bold">{formatHeadline(metric, r.value)}</td>
                      {reference && <td className="pr-3 font-mono text-slate-400">{r.ref != null ? formatHeadline(metric, r.ref) : '—'}</td>}
                      {reference && (
                        <td className={`pr-3 font-mono font-bold ${goodTone(r.good)}`}>
                          {r.diff != null ? <>{r.good ? <Icon name="chevronUp" /> : r.good === false ? <Icon name="chevronDown" /> : null} {formatDiff(metric, r.diff)} ({signed(r.pct)})</> : '—'}
                        </td>
                      )}
                      <td className="pr-3 font-mono">{r.vsFirstPct != null ? signed(r.vsFirstPct) : '—'}</td>
                      {hrRecovery && <td className="pr-3 font-mono">{hr ? `${hr.bpm} bpm` : '—'}</td>}
                    </tr>
                  )
                })}
                {match.onlyRef.map((rep) => (
                  <tr key={`ref-${rep}`} className="text-slate-400">
                    <th scope="row" className="py-1 pr-3">{rep}</th>
                    <td className="pr-3 italic">not detected</td>
                    <td className="pr-3 font-mono">{formatHeadline(metric, reference.reps.get(rep))}</td>
                    <td className="pr-3">—</td>
                    <td className="pr-3">—</td>
                    {hrRecovery && <td className="pr-3">—</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {match.note && <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400" data-testid="rep-note">{match.note}</p>}
          {hrRecovery && <p className="text-[10px] text-slate-400">HR recovery: average {hrRecovery.avg} bpm dropped in {hrRecovery.windowSec}s after a rep. Higher means better recovery.</p>}
        </div>
      )}

      {repCount >= 2 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-[10px] font-black uppercase tracking-wider text-slate-400">Fade curve</h4>
            <div className="flex gap-1 text-[10px] font-black uppercase tracking-wider" role="group" aria-label="Chart values">
              {[['pct', '% of best rep'], ['value', metric.label]].map(([key, label]) => (
                <button key={key} type="button" aria-pressed={chartMode === key} onClick={() => onChartModeChange(key)} className={`px-2 py-1 rounded-lg ${chartMode === key ? 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white' : 'text-slate-400'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <RepChart analysis={analysis} reference={reference} match={match} mode={chartMode} />
        </div>
      )}
      {mix === 0 && <p className="text-[11px] text-slate-400">No per-rep values in this run.</p>}

      <details className="group">
        <summary className="cursor-pointer text-[10px] font-black uppercase tracking-wider text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
          Trend over all runs
        </summary>
        <div className="pt-2">
          <TrendChart history={history} metric={metric} currentId={run.id} />
        </div>
      </details>
    </section>
  )
}

export { ridden }
