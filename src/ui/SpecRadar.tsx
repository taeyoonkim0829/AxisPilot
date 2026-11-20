import type { SpecRow } from '../calc/compare'
import { useT } from '../i18n'
import { fmt, pct } from './format'

export type Specs = { rows: SpecRow[]; reference: string; festo: string }

const W = 760
const H = 560
const CX = W / 2
const CY = H / 2
const R = 175
/** the scale's outer ring: 200% of the compared product's value */
const MAX = 2
const RINGS = [0.5, 1, 1.5, 2]

const specCell = (v: number | string | null, unit: string) =>
  v == null ? '—' : typeof v === 'number' ? `${fmt(v, 3)}${unit ? ` ${unit}` : ''}` : v

/**
 * 사양 비교 as a radar chart: one spoke per item on one scale, the compared product at 100% (dashed ring), the
 * Festo product's values as the blue area (0–200%, clamped at the outer ring). Items not on one scale (texts) are
 * listed below it.
 */
export function SpecRadar({ rows, reference, festo }: Specs) {
  const t = useT()
  // a radar needs three spokes; with fewer the numbers join the list
  const spokes = rows.filter((r) => r.ratio != null)
  const charted = spokes.length >= 3 ? spokes : []
  const listed = rows.filter((r) => !charted.includes(r))
  const n = charted.length
  const angle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n
  const at = (i: number, ratio: number): [number, number] => {
    const r = (Math.min(ratio, MAX) / MAX) * R
    return [CX + r * Math.cos(angle(i)), CY + r * Math.sin(angle(i))]
  }
  const polygon = (ratio: (i: number) => number) =>
    Array.from({ length: n }, (_, i) => at(i, ratio(i)).map((v) => v.toFixed(1)).join(',')).join(' ')
  return (
    <div className="radar">
      {n > 0 && (
        <>
          <div className="radar-legend">
            <span>
              <i className="radar-key radar-key-reference" />
              <span className="model">{reference}</span> (100%)
            </span>
            <span>
              <i className="radar-key radar-key-festo" />
              <span className="model">{festo}</span>
            </span>
          </div>
          <svg className="radar-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('사양 비교')}>
            {RINGS.map((ring) => (
              <polygon key={ring} className={ring === 1 ? 'radar-reference' : 'radar-ring'} points={polygon(() => ring)} />
            ))}
            {charted.map((_, i) => {
              const [x, y] = at(i, MAX)
              return <line key={i} className="radar-ring" x1={CX} y1={CY} x2={x} y2={y} />
            })}
            {RINGS.map((ring) => (
              <text key={ring} className="radar-scale" x={CX + 4} y={CY - (ring / MAX) * R - 3}>
                {pct(ring)}
              </text>
            ))}
            <polygon className="radar-festo" points={polygon((i) => charted[i].ratio!)} />
            {charted.map((r, i) => {
              const [x, y] = at(i, r.ratio!)
              return <circle key={r.label} className="radar-dot" cx={x} cy={y} r={4} />
            })}
            {charted.map((r, i) => {
              const cos = Math.cos(angle(i))
              const sin = Math.sin(angle(i))
              const x = CX + (R + 16) * cos
              // labels above the top spokes end at the ring, those below start at it
              const lines = 2 + (r.note ? 1 : 0)
              const y = CY + (R + 16) * sin + (sin < -0.3 ? -(lines - 1) * 16 - (sin < -0.9 ? 10 : 0) : sin > 0.3 ? 12 : -((lines - 1) * 16) / 2 + 4)
              const anchor = cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle'
              return (
                <text key={r.label} className="radar-label" x={x} y={y} textAnchor={anchor}>
                  <tspan className="radar-name">{t(r.label)}</tspan>
                  <tspan className="radar-pct" dx={6}>
                    {pct(r.ratio!)}
                  </tspan>
                  <tspan className="radar-values" x={x} dy={16}>
                    {specCell(r.reference, t(r.unit))} → {specCell(r.other, t(r.unit))}
                  </tspan>
                  {r.note && (
                    <tspan className="radar-note" x={x} dy={16}>
                      {t(r.note, r.noteArgs)}
                    </tspan>
                  )}
                </text>
              )
            })}
          </svg>
        </>
      )}
      {listed.length > 0 && (
        <dl className="radar-facts">
          <div className="radar-fact radar-fact-head">
            <dt />
            <dd className="model">{reference}</dd>
            <dd className="model">{festo}</dd>
          </div>
          {listed.map((r) => (
            <div key={r.label} className="radar-fact">
              <dt>
                {t(r.label)}
                {r.note && <span className="radar-fact-note muted">{t(r.note, r.noteArgs)}</span>}
              </dt>
              <dd>{specCell(r.reference, t(r.unit))}</dd>
              <dd>{specCell(r.other, t(r.unit))}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
