import { useEffect, useRef, useState } from 'react'
import type { SpecRow } from '../calc/compare'
import { useT } from '../i18n'
import { fmt, pct } from './format'

export type Specs = { rows: SpecRow[]; reference: string; festo: string }

const W = 760
const H = 560
const CX = W / 2
const CY = H / 2
const R = 175
/** Rings for an outer ring at `max`: every 50% up to 200%, 100% up to 500%, 200% beyond */
function ringsFor(max: number): number[] {
  const step = max <= 2 ? 0.5 : max <= 5 ? 1 : 2
  return Array.from({ length: Math.round(max / step) }, (_, i) => (i + 1) * step)
}

/** The fitted scale: the outer ring at the largest value of the items (at least the compared product's 100%), rounded up to the ring step */
function fittedMax(ratios: number[]): number {
  const top = Math.max(1, ...ratios)
  const step = top <= 2 ? 0.5 : top <= 5 ? 1 : 2
  return Math.ceil(top / step - 1e-9) * step
}

/** The outer rings the zoom steps through, 100% up to the fitted scale (each a whole number of ring steps) */
function zoomLadder(fitted: number): number[] {
  const ladder = [1, 1.5, 2, 3, 4, 5]
  for (let v = 6; v <= fitted; v += 2) ladder.push(v)
  return ladder.filter((v) => v <= fitted)
}

/** The next outer ring in (d = 1) or out (d = −1) from `z` (null: fitted), within 100% … fitted */
function stepZoom(z: number | null, fitted: number, d: 1 | -1): number {
  const ladder = zoomLadder(fitted)
  const cur = Math.min(fitted, z ?? fitted)
  return (d > 0 ? ladder.filter((v) => v < cur).at(-1) : ladder.find((v) => v > cur)) ?? cur
}

/** The note's lines (11px) within `max` px: SVG text does not wrap; widths estimated, CJK at a full em */
function wrapNote(text: string, max: number): string[] {
  const width = (s: string) => [...s].reduce((w, c) => w + (c.charCodeAt(0) >= 0x2e80 ? 11 : 6.2), 0)
  const lines: string[] = []
  for (const word of text.split(' ')) {
    const last = lines.at(-1)
    if (last != null && width(`${last} ${word}`) <= max) lines[lines.length - 1] = `${last} ${word}`
    else lines.push(word)
  }
  return lines
}

const specCell = (v: number | string | null, unit: string) =>
  v == null ? '—' : typeof v === 'number' ? `${fmt(v, 3)}${unit ? ` ${unit}` : ''}` : v

/**
 * 사양 비교 as a radar chart: one spoke per item on one scale, the compared product at 100% (dashed ring), the
 * Festo product's values as the blue area, the scale up to the largest value (`radarScale`). Items not on one scale (texts) are
 * listed below it, the item in the middle between the two products' values. The scale zooms (− / +, Ctrl + wheel or
 * pinch) between 100% and the fitted scale; values beyond it sit on the rim as hollow dots.
 */
export function SpecRadar({ rows, reference, festo, zoomable = true }: Specs & { zoomable?: boolean }) {
  const t = useT()
  // the outer ring the user zoomed to (null: fitted); the PDF passes zoomable = false and prints the fitted scale
  const [zoomed, setZoomed] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  // a radar needs three spokes; with fewer the numbers join the list
  const spokes = rows.filter((r) => r.ratio != null)
  const charted = spokes.length >= 3 ? spokes : []
  const listed = rows.filter((r) => !charted.includes(r))
  const n = charted.length
  const fitted = fittedMax(charted.map((r) => r.ratio!))
  const MAX = zoomable && zoomed != null ? Math.min(fitted, Math.max(1, zoomed)) : fitted
  const rings = ringsFor(MAX)
  const zoomTo = (d: 1 | -1) => setZoomed((z) => stepZoom(z, fitted, d))
  // Ctrl + wheel and trackpad pinch (a wheel event with ctrlKey) zoom; a plain wheel keeps scrolling the page
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !zoomable) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const d = e.deltaY < 0 ? 1 : -1
      setZoomed((z) => stepZoom(z, fitted, d))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [zoomable, n, fitted])
  const over = (ratio: number) => ratio > MAX + 1e-9
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
            {charted.some((r) => over(r.ratio!)) && (
              <span>
                <i className="radar-key radar-key-over" />
                {t('▲ 눈금 밖 (테두리에 표시)')}
              </span>
            )}
          </div>
          {zoomable && (
            <div className="radar-zoom">
              <button type="button" className="count-btn" aria-label={t('축소')} disabled={MAX >= fitted} onClick={() => zoomTo(-1)}>
                −
              </button>
              <span className="radar-zoom-value" aria-live="polite">
                {t('최대 눈금 {pct}', { pct: pct(MAX) })}
              </span>
              <button type="button" className="count-btn" aria-label={t('확대')} disabled={MAX <= 1} onClick={() => zoomTo(1)}>
                +
              </button>
              <button type="button" className="radar-zoom-fit" disabled={MAX >= fitted} onClick={() => setZoomed(null)}>
                {t('맞춤')}
              </button>
            </div>
          )}
          <svg ref={svgRef} className="radar-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('사양 비교')}>
            {rings
              .filter((ring) => ring !== 1)
              .map((ring) => (
                <polygon key={ring} className="radar-ring" points={polygon(() => ring)} />
              ))}
            <polygon className="radar-reference" points={polygon(() => 1)} />
            {MAX > 1 && <polygon className="radar-ring radar-rim" points={polygon(() => MAX)} />}
            {charted.map((_, i) => {
              const [x, y] = at(i, MAX)
              return <line key={i} className="radar-ring" x1={CX} y1={CY} x2={x} y2={y} />
            })}
            {rings.map((ring) => (
              <text key={ring} className="radar-scale" x={CX + 4} y={CY - (ring / MAX) * R - 3}>
                {pct(ring)}
              </text>
            ))}
            <polygon className="radar-festo" points={polygon((i) => charted[i].ratio!)} />
            {charted.map((r, i) => {
              const [x, y] = at(i, r.ratio!)
              // beyond the zoomed scale: a hollow dot on the rim, the label keeps the true percentage
              return over(r.ratio!) ? (
                <circle key={i} className="radar-dot radar-dot-over" cx={x} cy={y} r={6}>
                  <title>{t('눈금 밖 {pct}', { pct: pct(r.ratio!) })}</title>
                </circle>
              ) : (
                <circle key={i} className="radar-dot" cx={x} cy={y} r={4} />
              )
            })}
            {charted.map((r, i) => {
              const cos = Math.cos(angle(i))
              const sin = Math.sin(angle(i))
              const x = CX + (R + 16) * cos
              const anchor = cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle'
              // the note wraps within the room between the label's anchor and the chart's edge
              const room = anchor === 'start' ? W - x : anchor === 'end' ? x : 2 * Math.min(x, W - x)
              const note = r.note ? wrapNote(t(r.note, r.noteArgs), room - 12) : []
              // labels above the top spokes end at the ring, those below start at it
              const below = 16 + note.length * 14
              const y = CY + (R + 16) * sin + (sin < -0.3 ? -below - (sin < -0.9 ? 10 : 0) : sin > 0.3 ? 12 : -below / 2 + 4)
              return (
                <text key={i} className="radar-label" x={x} y={y} textAnchor={anchor}>
                  <tspan className="radar-name">{t(r.label)}</tspan>
                  <tspan className="radar-pct" dx={6}>
                    {over(r.ratio!) ? '▲ ' : ''}
                    {pct(r.ratio!)}
                  </tspan>
                  <tspan className="radar-values" x={x} dy={16}>
                    {specCell(r.reference, t(r.unit))} → {specCell(r.other, t(r.unit))}
                  </tspan>
                  {note.map((line, k) => (
                    <tspan key={k} className="radar-note" x={x} dy={k === 0 ? 16 : 14}>
                      {line}
                    </tspan>
                  ))}
                </text>
              )
            })}
          </svg>
        </>
      )}
      {listed.length > 0 && (
        <dl className="radar-facts">
          <div className="radar-fact radar-fact-head">
            <dd className="model">{reference}</dd>
            <dt />
            <dd className="model">{festo}</dd>
          </div>
          {listed.map((r, i) => (
            <div key={i} className="radar-fact">
              <dd>{specCell(r.reference, t(r.unit))}</dd>
              <dt>
                {t(r.label)}
                {r.note && <span className="radar-fact-note muted">{t(r.note, r.noteArgs)}</span>}
              </dt>
              <dd>{specCell(r.other, t(r.unit))}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
