import { useState, type ReactNode } from 'react'
import type { Check, Status } from '../calc/types'
import { useT } from '../i18n'
import { fmt, pct, statusLabel } from './format'
import type { SortState } from './useSort'
import { useSlideThumb } from './useSlideThumb'

export function StatusBadge({ status, dot }: { status: Status; dot?: boolean }) {
  const t = useT()
  const word = t(statusLabel[status])
  // dot: the coloured dot alone, the word for hover and screen readers
  if (dot) return <span className={`badge badge-${status}`} role="img" title={word} aria-label={word} />
  return <span className={`badge badge-${status}`}>{word}</span>
}

/** Utilisation cell: percentage plus a thin bar. */
export function Ratio({ ratio, status }: { ratio: number | null; status?: Status }) {
  if (ratio == null) return <span className="muted">—</span>
  const tone = status ?? (ratio > 1 ? 'fail' : ratio > 0.8 ? 'warn' : 'ok')
  return (
    <span className="ratio">
      <span className="ratio-text">{pct(ratio)}</span>
      <span className="ratio-bar">
        <span className={`ratio-fill fill-${tone}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </span>
    </span>
  )
}

export function CheckTable({ checks }: { checks: Check[] }) {
  const t = useT()
  return (
    <table className="check-table">
      <thead>
        <tr>
          <th>{t('항목')}</th>
          <th className="num">{t('계산값')}</th>
          <th className="num">{t('허용값')}</th>
          <th>{t('부하율')}</th>
          <th>{t('판정')}</th>
        </tr>
      </thead>
      <tbody>
        {checks.map((c) => (
          <tr key={c.label}>
            <td>
              {t(c.label)}
              {c.note && <div className="note">{t(c.note, c.noteArgs)}</div>}
            </td>
            <td className="num">
              {fmt(c.value, 3)} <span className="unit">{t(c.unit)}</span>
            </td>
            <td className="num">
              {c.limit == null ? '—' : fmt(c.limit, 3)} {c.limit != null && <span className="unit">{t(c.unit)}</span>}
            </td>
            <td>
              <Ratio ratio={c.ratio} status={c.status === 'ok' ? undefined : c.status} />
            </td>
            <td>
              <StatusBadge status={c.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface NumberFieldProps {
  label: string
  unit?: string
  value: number
  onChange: (value: number) => void
  min?: number
  step?: number
  hint?: string
}

/** Number input that keeps the raw text while typing and reports only valid numbers. */
export function NumberField({ label, unit, value, onChange, min = 0, step, hint }: NumberFieldProps) {
  const [text, setText] = useState(String(value))
  const [prev, setPrev] = useState(value)
  if (value !== prev) {
    setPrev(value)
    if (Number(text) !== value) setText(String(value))
  }
  const invalid = text.trim() === '' || !Number.isFinite(Number(text)) || Number(text) < min
  return (
    <label className={`field${invalid ? ' field-invalid' : ''}`}>
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          type="number"
          inputMode="decimal"
          value={text}
          min={min}
          step={step ?? 'any'}
          onChange={(e) => {
            setText(e.target.value)
            const n = Number(e.target.value)
            if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= min) onChange(n)
          }}
        />
        {unit && <span className="field-unit">{unit}</span>}
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

/** Whole-number count: typed in, or stepped with the small − / + buttons at the right, kept within min…max. */
export function CountField({ label, value, onChange, min, max }: { label: string; value: number; onChange: (value: number) => void; min: number; max: number }) {
  const t = useT()
  const [text, setText] = useState(String(value))
  const [prev, setPrev] = useState(value)
  if (value !== prev) {
    setPrev(value)
    if (Number(text) !== value) setText(String(value))
  }
  const n = Number(text)
  const invalid = text.trim() === '' || !Number.isInteger(n) || n < min || n > max
  const step = (d: number) => onChange(Math.min(max, Math.max(min, value + d)))
  return (
    <div className={`field${invalid ? ' field-invalid' : ''}`}>
      <label className="field-label" htmlFor={`count-${label}`}>
        {label}
      </label>
      <span className="field-input count-input">
        <input
          id={`count-${label}`}
          type="number"
          inputMode="numeric"
          value={text}
          min={min}
          max={max}
          step={1}
          onChange={(e) => {
            setText(e.target.value)
            const v = Number(e.target.value)
            if (e.target.value.trim() !== '' && Number.isInteger(v) && v >= min && v <= max) onChange(v)
          }}
        />
        <button type="button" className="count-btn" aria-label={t('줄이기')} disabled={value <= min} onClick={() => step(-1)}>
          −
        </button>
        <button type="button" className="count-btn" aria-label={t('늘리기')} disabled={value >= max} onClick={() => step(1)}>
          +
        </button>
      </span>
    </div>
  )
}

interface ToggleGroupProps<T extends string> {
  options: readonly T[]
  selected: readonly T[]
  onChange: (selected: T[]) => void
  label?: (value: T) => string
  /** Adds a leading "전체" button that selects every option. */
  all?: boolean
}

/** Multi-select segmented buttons. The last selected option cannot be turned off. */
export function ToggleGroup<T extends string>({ options, selected, onChange, label = (v) => v, all }: ToggleGroupProps<T>) {
  const t = useT()
  const allOn = options.every((o) => selected.includes(o))
  return (
    <div className="segmented small" role="group">
      {all && (
        <button type="button" aria-pressed={allOn} className={allOn ? 'active' : ''} onClick={() => onChange([...options])}>
          {t('전체')}
        </button>
      )}
      {options.map((o) => {
        const on = selected.includes(o)
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            className={on ? 'active' : ''}
            onClick={() => {
              if (!on) onChange(options.filter((x) => x === o || selected.includes(x)))
              else if (selected.length > 1) onChange(selected.filter((x) => x !== o))
            }}
          >
            {label(o)}
          </button>
        )
      })}
    </div>
  )
}

/** A single on/off button styled like the segmented groups. */
export function ToggleButton({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="segmented small">
      <button type="button" aria-pressed={checked} className={checked ? 'active' : ''} onClick={() => onChange(!checked)}>
        {label}
      </button>
    </div>
  )
}

/** Section heading that shows or hides the section body. */
export function CollapseTitle({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <h3>
      <button type="button" className="collapse-btn" aria-expanded={open} onClick={onToggle}>
        <span className="collapse-chevron" aria-hidden="true" />
        {children}
      </button>
    </h3>
  )
}

/**
 * One-of choice as segmented buttons, the highlight sliding to the picked one (`useSlideThumb`, `.segmented-thumb`).
 * `className` replaces the size class (default `small`).
 */
export function RadioGroup<T extends string | number>({
  options,
  value,
  onChange,
  label = (v) => v,
  className = 'small',
  ariaLabel,
}: {
  options: readonly T[]
  value: T
  onChange: (value: T) => void
  label?: (value: T) => ReactNode
  className?: string
  ariaLabel?: string
}) {
  const { ref, thumb } = useSlideThumb<HTMLDivElement>(options.indexOf(value), options.length)
  return (
    <div className={`segmented sliding ${className}`.trim()} role="radiogroup" aria-label={ariaLabel} ref={ref}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={o === value}
          className={o === value ? 'active' : ''}
          onClick={() => o !== value && onChange(o)}
        >
          {label(o)}
        </button>
      ))}
      {/* after the buttons, so their nth-child rules stay */}
      {thumb && <span className="segmented-thumb" aria-hidden style={thumb} />}
    </div>
  )
}

/** Table header cell that toggles sorting on its column. */
export function SortTh({
  id,
  sort,
  onSort,
  num,
  children,
}: {
  id: string
  sort: SortState
  onSort: (key: string) => void
  num?: boolean
  children: ReactNode
}) {
  const dir = sort?.key === id ? sort.dir : null
  return (
    <th className={num ? 'num' : undefined} aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}>
      <button type="button" className={`sort-btn${dir ? ' active' : ''}`} onClick={() => onSort(id)}>
        {children}
        <span className="sort-arrow" aria-hidden="true">
          {dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '↕'}
        </span>
      </button>
    </th>
  )
}
