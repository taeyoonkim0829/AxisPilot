import { useEffect, useId, useMemo, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import {
  axisCandidates,
  axisSpecRows,
  COMPARE_AXIS_FAMILIES,
  festoVariant,
  motorCandidates,
  motorOptionRows,
  motorSpecRows,
  fullModel,
  fullModels,
  robostarModel,
  robostarModels,
  robostarStrokes,
  type RobostarOptions,
  offeredOptions,
  referenceOptions,
  supplyOf,
  type SupplyClass,
} from '../calc/compare'
import { axisOrder } from '../calc/axisSelection'
import { axes, motorFamilies, motors, thirdPartyAxes } from '../data'
import type { Axis, AxisSeries, Motor, MotorOptions, ThirdPartyAxis } from '../data/types'
import { useLang, useT } from '../i18n'
import { RadioGroup, SortTh, ToggleButton, ToggleGroup } from './common'
import { Footer } from './Footer'
import { fmt, pct } from './format'
import { SpecRadar, type Specs } from './SpecRadar'
import { useReportExport } from './useReportExport'
import { useSort, type SortValue } from './useSort'

/**
 * 제품 비교: another maker's product (the reference, picked by maker, series and model) and the Festo products that
 * could replace it, from their data alone. Left: the reference and the candidate filters; right: the pair, the
 * candidates (closest first, a row picks one) and the data as a radar chart, the Festo value against the
 * reference's (reference = 100%).
 */
export function CompareWorkspace({ kind }: { kind: 'axis' | 'motor' }) {
  return <div className="app compare">{kind === 'axis' ? <AxisCompare /> : <MotorCompare />}</div>
}

const unique = <T,>(list: T[]) => [...new Set(list)]

/** A labelled select in the reference box */
function Select<T extends string>({ label, value, options, onChange, text = (v) => v }: { label: string; value: T; options: T[]; onChange: (v: T) => void; text?: (v: T) => string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <select className="field-select" value={value} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((o) => (
            <option key={o} value={o}>
              {text(o)}
            </option>
          ))}
        </select>
      </span>
    </label>
  )
}

const robostarModelNames = (a: ThirdPartyAxis) => robostarModels(a).map((f) => f.model)
const fullModelNames = (m: Motor) => fullModels(m).map((f) => f.model)
const squash =(s: string) => s.toLowerCase().replace(/[\s\-_/.()]/g, '')

/**
 * Finds a compared product by its model name among every maker and series (the whole name, any part of it,
 * case, spaces, hyphens, underscores, dots, slashes and brackets ignored), in a list below the field (combobox):
 * a click or Enter picks (Enter the highlighted suggestion, else the first), the arrow keys move, Escape closes.
 */
function ModelSearch<T extends { id: string; model: string; maker: string }>({
  items,
  sub,
  names,
  onPick,
}: {
  items: T[]
  sub: (i: T) => string
  /** further names an item is found by (motors: the full model names of its order options) */
  names?: (i: T) => string[]
  /** the item and the name it was found by */
  onPick: (i: T, name: string) => void
}) {
  const t = useT()
  const id = useId()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(-1)
  const index = useMemo(() => items.map((i) => ({ i, names: [i.model, ...(names?.(i) ?? [])].map((n) => [n, squash(n)] as const) })), [items, names])
  const k = squash(q)
  // each item once, by the first of its names that matches (the base model before the full names)
  const matches = k
    ? index
        .flatMap(({ i, names }) => {
          const hit = names.find(([, s]) => s.includes(k))
          return hit ? [{ i, name: hit[0] }] : []
        })
        .slice(0, 50)
    : []
  const shown = open && matches.length > 0
  useEffect(() => {
    if (hi >= 0) document.getElementById(`${id}-${hi}`)?.scrollIntoView({ block: 'nearest' })
  }, [id, hi])
  const take = (m: (typeof matches)[number] | undefined) => {
    if (!m) return
    onPick(m.i, m.name)
    setQ('')
    setOpen(false)
    setHi(-1)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      setHi((h) => (e.key === 'ArrowDown' ? Math.min(h + 1, matches.length - 1) : Math.max(h - 1, 0)))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      take(matches[hi] ?? matches[0])
    } else if (e.key === 'Escape') setOpen(false)
  }
  return (
    <label className="field compare-search">
      <span className="field-label">{t('모델명 검색')}</span>
      <span className="field-input">
        <input
          className="field-select"
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={shown}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={shown && hi >= 0 ? `${id}-${hi}` : undefined}
          value={q}
          placeholder={t('모델명 입력')}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
            setHi(-1)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKey}
        />
        <svg className="compare-search-icon" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4.5 4.5" />
        </svg>
      </span>
      <ul id={`${id}-list`} role="listbox" className="compare-search-list" hidden={!shown}>
        {matches.map(({ i, name }, n) => (
          <li
            key={i.id}
            id={`${id}-${n}`}
            role="option"
            aria-selected={n === hi}
            className={n === hi ? 'active' : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setHi(n)}
            onClick={() => take(matches[n])}
          >
            <span>{name}</span>
            <small>{`${i.maker} · ${sub(i)}`}</small>
          </li>
        ))}
      </ul>
    </label>
  )
}

/** Label / value list under the reference's choice */
function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="compare-facts">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The reference and the picked Festo product, at the top of the results */
type Item = { maker: string; model: string; line: string }

function CompareBar({ reference, festo, onExport, exporting }: { reference: Item; festo: Omit<Item, 'maker'> | null; onExport: () => void; exporting: boolean }) {
  const t = useT()
  return (
    <div className="panel compare-bar">
      <div className="compare-bar-item">
        <span className="compare-bar-role">{t('비교 제품')} · {reference.maker}</span>
        <span className="compare-bar-model">{reference.model}</span>
        <span className="compare-bar-line">{reference.line}</span>
      </div>
      <svg className="compare-bar-arrow" aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 12h15" />
        <path d="M13 6l6 6-6 6" />
      </svg>
      <div className="compare-bar-item">
        <span className="compare-bar-role">{t('Festo 제품')}</span>
        <span className={`compare-bar-model${festo ? '' : ' sign-empty'}`}>{festo?.model ?? t('해당 제품 없음')}</span>
        {festo && <span className="compare-bar-line">{festo.line}</span>}
      </div>
      <div className="rail-actions">
        <button type="button" className="rail-action" onClick={onExport} disabled={exporting || !festo}>
          {exporting ? t('PDF 생성 중…') : t('PDF로 내보내기')}
        </button>
      </div>
    </div>
  )
}

function SpecTable(specs: Specs) {
  const t = useT()
  return (
    <section className="panel step">
      <header className="step-head">
        <h2>{t('사양 비교')}</h2>
      </header>
      <SpecRadar {...specs} />
    </section>
  )
}

/**
 * The PDF (one chapter, pdfExport): the pair and the data side by side. Mounted while exporting, off screen on
 * the body, outside `.app`, so it keeps the report's light look.
 */
function CompareReport({ stageRef, kind, reference, festo, specs }: { stageRef: RefObject<HTMLDivElement | null>; kind: string; reference: Item; festo: Omit<Item, 'maker'>; specs: Specs }) {
  const t = useT()
  const lang = useLang()
  const [today] = useState(() => new Date().toLocaleDateString(lang === 'ko' ? 'ko-KR' : 'en-US'))
  return createPortal(
    <div className="report-stage" ref={stageRef} aria-hidden="true">
      <div className="report">
        <section className="report-chapter">
          <h2>
            {t('제품 비교')} · {kind}
          </h2>
          <p className="report-meta">{t('제품 비교서 · {date}', { date: today })}</p>
          <table className="report-spec">
            <tbody>
              <tr>
                <th>
                  {t('비교 제품')} · {reference.maker}
                </th>
                <td>{reference.model}</td>
                <td colSpan={2}>{reference.line}</td>
              </tr>
              <tr>
                <th>{t('Festo 제품')}</th>
                <td>{festo.model}</td>
                <td colSpan={2}>{festo.line}</td>
              </tr>
            </tbody>
          </table>
          <h3>{t('사양 비교')}</h3>
          <SpecRadar {...specs} />
        </section>
      </div>
    </div>,
    document.body,
  )
}

/** PDF export of a comparison: file name 제품비교_<compared>_<Festo>_<date> */
function useCompareExport(reference: string, festo: string | null) {
  const lang = useLang()
  return useReportExport(lang, festo && `${reference}_${festo}`, undefined, '제품비교_{model}_{date}')
}

/** Candidates table: a row picks the Festo product compared below */
function CandidateTable<T extends { id: string }>({
  title,
  note,
  rows,
  selected,
  onSelect,
  columns,
}: {
  title: string
  note: string
  rows: T[]
  selected: string | null
  onSelect: (id: string) => void
  /** num: right-aligned numbers; data: left-aligned in the data face */
  columns: { head: string; cell: (r: T) => ReactNode; sort: (r: T) => SortValue; num?: boolean; data?: boolean }[]
}) {
  const t = useT()
  const { sorted, sort, toggle } = useSort(rows, Object.fromEntries(columns.map((c) => [c.head, c.sort])))
  return (
    <section className="panel step">
      <header className="step-head">
        <h2>{title}</h2>
        <span className="step-count">{note}</span>
      </header>
      {rows.length === 0 ? (
        <p className="empty">{t('조건에 맞는 Festo 제품이 없습니다. 대체 조건을 넓혀 보세요.')}</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <SortTh key={c.head} id={c.head} sort={sort} onSort={toggle} num={c.num}>
                    {c.head}
                  </SortTh>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className={r.id === selected ? 'selected' : ''} onClick={() => onSelect(r.id)} tabIndex={0} onKeyDown={(k) => k.key === 'Enter' && onSelect(r.id)}>
                  {columns.map((c) => (
                    <td key={c.head} className={c.num ? 'num' : c.data ? 'data' : undefined}>
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/** The picked row, else the first */
const picked = <T extends { id: string }>(rows: T[], id: string | null) => rows.find((r) => r.id === id) ?? rows[0] ?? null

// ---------- 직교 축 ----------

const axisLine = (a: ThirdPartyAxis | Axis, t: (s: string) => string) => {
  const spindle = a.drive === 'spindle'
  const stroke = 'strokeMax' in a ? a.strokeMax : a.maxStroke
  return `${t(spindle ? '볼스크류' : '벨트')} · ${fmt(a.maxSpeed, 3)} m/s · ${fmt(stroke, 0)} mm`
}

function AxisCompare() {
  const t = useT()
  const makers = unique(thirdPartyAxes.map((a) => a.maker))
  const [maker, setMaker] = useState(makers[0])
  const seriesList = unique(thirdPartyAxes.filter((a) => a.maker === maker).map((a) => a.series))
  const [series, setSeries] = useState('RS')
  const seriesNow = seriesList.includes(series) ? series : seriesList[0]
  const models = thirdPartyAxes.filter((a) => a.maker === maker && a.series === seriesNow)
  const [modelId, setModelId] = useState('RS-120-X20SS')
  const ref = models.find((a) => a.id === modelId) ?? models[0]
  const [families, setFamilies] = useState<AxisSeries[]>(COMPARE_AXIS_FAMILIES)
  const [atLeast, setAtLeast] = useState(true)
  const [pick, setPick] = useState<string | null>(null)
  const list = axisCandidates(ref, axes, { drive: ref.drive, families, atLeast })
  const festo = picked(list, pick)
  // the full model names: Robostar's for its order options, the Festo axis ordered at the same stroke
  const [options, setOptions] = useState<RobostarOptions>({ stroke: 500, encoder: 'A', hand: 'R' })
  const strokes = robostarStrokes(ref)
  const opts = { ...options, stroke: strokes.filter((s) => s <= options.stroke).at(-1) ?? strokes[0] }
  const refModel = robostarModel(ref, opts) ?? ref.model
  const order = festo ? axisOrder(festo, opts.stroke) : null
  const festoModel = ref.drive === 'spindle' && order ? order.model : (festo?.model ?? '')
  const { exporting, start, reportRef } = useCompareExport(refModel, festo ? festoModel : null)
  const reference = { maker: ref.maker, model: refModel, line: axisLine(ref, t) }
  const festoBar = festo ? { model: festoModel, line: `${axisLine(festo, t)}${ref.drive === 'spindle' && order?.partNumber ? ` · ${order.partNumber}` : ''}` } : null
  const specs = festo && { rows: axisSpecRows(ref, festo), reference: refModel, festo: festoModel }

  return (
    <main className="layout">
      <aside className="inputs">
        <div className="panel inputs-main">
          <section>
            <h2>{t('비교 제품')}</h2>
            <ModelSearch
              items={thirdPartyAxes}
              sub={(a) => a.series}
              names={robostarModelNames}
              onPick={(a, name) => {
                setMaker(a.maker)
                setSeries(a.series)
                setModelId(a.id)
                const full = robostarModels(a).find((f) => f.model === name)
                if (full) setOptions(full.options)
              }}
            />
            <Select label={t('제조사')} value={maker} options={makers} onChange={setMaker} />
            <Select label={t('시리즈')} value={seriesNow} options={seriesList} onChange={setSeries} />
            <Select label={t('모델')} value={ref.id} options={models.map((a) => a.id)} onChange={setModelId} />
            <Facts
              rows={[
                [t('스트로크'), `${fmt(ref.strokeMin, 0)}–${fmt(ref.strokeMax, 0)} mm`],
                [t('최고 속도'), `${fmt(ref.maxSpeed, 3)} m/s`],
                ref.payload
                  ? [t('가반 질량 0.3G / 0.5G'), `${fmt(ref.payload[0])} / ${fmt(ref.payload[1])} kg`]
                  : [t('최대 가반 질량'), `${fmt(ref.maxPayload)} kg`],
                ref.drive === 'spindle' ? [t('볼스크류'), `Ø${ref.screwDiameter} × ${ref.screwLead} (${ref.screwClass})`] : [t('벨트'), ref.belt ?? '—'],
                [t('모터'), `AC ${t('서보')} ${ref.motorPower} W${ref.brake ? ` · ${t('브레이크')}` : ''}`],
                ...(ref.axisUse ? ([[t('축 용도'), ref.axisUse]] as [string, ReactNode][]) : []),
              ]}
            />
            {ref.drive === 'spindle' && (
              <>
                <Select
                  label={t('주문 스트로크')}
                  value={String(opts.stroke)}
                  options={strokes.map(String)}
                  onChange={(v) => setOptions((o) => ({ ...o, stroke: Number(v) }))}
                  text={(v) => `${v} mm`}
                />
                <div className="field">
                  <span className="field-label">{t('엔코더')}</span>
                  <RadioGroup
                    options={['A', 'I'] as const}
                    value={opts.encoder}
                    onChange={(encoder) => setOptions((o) => ({ ...o, encoder }))}
                    label={(v) => t(v === 'A' ? '앱솔루트' : '인크리멘탈')}
                  />
                </div>
                {ref.layout === 'PR' && (
                  <div className="field">
                    <span className="field-label">{t('병렬 방향')}</span>
                    <RadioGroup
                      options={['R', 'L'] as const}
                      value={opts.hand}
                      onChange={(hand) => setOptions((o) => ({ ...o, hand }))}
                      label={(v) => t(v === 'R' ? '우측' : '좌측')}
                    />
                  </div>
                )}
              </>
            )}
          </section>
          <section>
            <h2>{t('Festo 제품')}</h2>
            <div className="field">
              <span className="field-label">{t('구동')}</span>
              <span>{t(ref.drive === 'spindle' ? '볼스크류' : '벨트')}</span>
            </div>
            <div className="field">
              <span className="field-label">{t('시리즈')}</span>
              <ToggleGroup options={COMPARE_AXIS_FAMILIES} selected={families} onChange={setFamilies} />
            </div>
            <ToggleButton label={t('비교 제품 스트로크·속도 이상만')} checked={atLeast} onChange={setAtLeast} />
          </section>
        </div>
      </aside>
      <div className="results">
        <CompareBar reference={reference} festo={festoBar} onExport={start} exporting={exporting} />
        <CandidateTable
          title={t('Festo 대체 제품')}
          note={t('제품 데이터 · 비교 제품과 가까운 순 · {n}개', { n: list.length })}
          rows={list}
          selected={festo?.id ?? null}
          onSelect={setPick}
          columns={[
            { head: t('모델명'), sort: (a) => a.model, cell: (a) => <span className="model">{ref.drive === 'spindle' ? axisOrder(a, opts.stroke).model : a.model}</span> },
            { head: t('최대 스트로크'), num: true, sort: (a) => a.maxStroke, cell: (a) => `${fmt(a.maxStroke, 0)} mm` },
            { head: t('최고 속도'), num: true, sort: (a) => a.maxSpeed, cell: (a) => `${fmt(a.maxSpeed, 3)} m/s` },
            ...(ref.drive === 'spindle'
              ? [{ head: t('볼스크류'), num: true, sort: (a: Axis) => (a.spindleDiameter ? a.spindleDiameter * 1000 + (a.spindlePitch ?? 0) : null), cell: (a: Axis) => (a.spindleDiameter ? `Ø${a.spindleDiameter} × ${a.spindlePitch}` : '—') }]
              : [{ head: t('피드 상수'), num: true, sort: (a: Axis) => a.feedConstant ?? null, cell: (a: Axis) => (a.feedConstant ? `${fmt(a.feedConstant)} mm/rev` : '—') }]),
            { head: t('최대 이송력'), num: true, sort: (a) => a.maxFeedForce ?? null, cell: (a) => (a.maxFeedForce ? `${fmt(a.maxFeedForce, 0)} N` : '—') },
            { head: 'Fy / Fz', num: true, sort: (a) => a.FyMax ?? null, cell: (a) => (a.FyMax != null && a.FzMax != null ? `${fmt(a.FyMax, 0)} / ${fmt(a.FzMax, 0)} N` : '—') },
            { head: t('속도 비교'), num: true, sort: (a) => a.maxSpeed, cell: (a) => pct(a.maxSpeed / ref.maxSpeed) },
          ]}
        />
        {specs && <SpecTable {...specs} />}
        <Footer />
      </div>
      {exporting && festoBar && specs && <CompareReport stageRef={reportRef} kind={t('직교 축')} reference={reference} festo={festoBar} specs={specs} />}
    </main>
  )
}

// ---------- 모터 ----------

const thirdPartyMakers = ['Siemens', 'Mitsubishi', 'LS'] as const
const supplies: (SupplyClass | 'all')[] = ['all', 'AC 380–480 V', 'AC 200–240 V']
const OPTION_LABEL: Record<keyof MotorOptions, string> = { shaft: '축 끝', seal: '축 씰', encoder: '엔코더' }

/** Every compared motor (the makers offered), for the model search */
const searchMotors = motors.filter((m) => (thirdPartyMakers as readonly string[]).includes(m.maker))
const motorLine = (m: Motor) => `${fmt(m.ratedPower, 0)} W · ${fmt(m.ratedTorque)} Nm${supplyOf(m) ? ` · ${supplyOf(m)}` : ''}`

function MotorCompare() {
  const t = useT()
  const [maker, setMaker] = useState<(typeof thirdPartyMakers)[number]>('Siemens')
  const familyList = motorFamilies[maker] ?? []
  const [family, setFamily] = useState('1FK2')
  const familyNow = familyList.includes(family) ? family : familyList[0]
  const models = motors.filter((m) => m.maker === maker && m.family === familyNow)
  const [modelId, setModelId] = useState<string | null>(null)
  const ref = models.find((m) => m.id === modelId) ?? models.find((m) => m.model === '1FK2104-4AF0') ?? models[0]
  const festoFamilies = motorFamilies.Festo
  const [families, setFamilies] = useState<string[]>(festoFamilies.filter((f) => f.endsWith('-AS')))
  const [supply, setSupply] = useState<SupplyClass | 'all'>('all')
  const [samePower, setSamePower] = useState(true)
  const [sameInterface, setSameInterface] = useState(false)
  const [pick, setPick] = useState<string | null>(null)
  const [options, setOptions] = useState<MotorOptions>({ shaft: 'plain', seal: false, encoder: 'multi' })
  const option = <K extends keyof MotorOptions>(k: K) => (v: MotorOptions[K]) => setOptions((o) => ({ ...o, [k]: v }))
  const list = motorCandidates(ref, motors, { families, supply: supply === 'all' ? null : supply, samePower, sameInterface })
  const festo = picked(list, pick)
  // the full model names: the compared motor's for its order options and the Festo variant for the same options
  const offered = referenceOptions(ref)
  const opts = offeredOptions(ref, options)
  const refModel = fullModel(ref, opts) ?? ref.model
  const match = festo ? festoVariant(festo, opts) : null
  const festoModel = match?.variant?.orderCode ?? festo?.orderCode ?? festo?.model ?? ''
  const festoLine = (m: Motor) => {
    const pn = match?.variant ? (match.variant.partNumber ?? t('품번 없음 (타입 코드 주문)')) : m.partNumber
    const differs = match?.differs.length ? ` · ${t('선택 불가: {what}', { what: match.differs.map((k) => t(OPTION_LABEL[k])).join(', ') })}` : ''
    return `${motorLine(m)}${pn ? ` · ${pn}` : ''}${differs}`
  }
  const { exporting, start, reportRef } = useCompareExport(refModel, festo ? festoModel : null)
  const reference = { maker: ref.maker, model: refModel, line: motorLine(ref) }
  const festoBar = festo ? { model: festoModel, line: festoLine(festo) } : null
  const specs = festo && {
    rows: [...motorSpecRows(ref, festo), ...(offered ? motorOptionRows(opts, match?.variant ?? null, ref.brake, festo.brake) : [])],
    reference: refModel,
    festo: festoModel,
  }

  return (
    <main className="layout">
      <aside className="inputs">
        <div className="panel inputs-main">
          <section>
            <h2>{t('비교 제품')}</h2>
            <ModelSearch
              items={searchMotors}
              sub={(m) => `${m.family}${m.model.match(/( \([^)]*\))+$/)?.[0] ?? ''}`}
              names={fullModelNames}
              onPick={(m, name) => {
                setMaker(m.maker as (typeof thirdPartyMakers)[number])
                setFamily(m.family)
                setModelId(m.id)
                const full = fullModels(m).find((f) => f.model === name)
                if (full) setOptions(full.options)
              }}
            />
            <Select label={t('제조사')} value={maker} options={[...thirdPartyMakers]} onChange={setMaker} />
            <Select label={t('시리즈')} value={familyNow} options={familyList} onChange={setFamily} />
            <Select label={t('모델')} value={ref.id} options={models.map((m) => m.id)} onChange={setModelId} text={(id) => models.find((m) => m.id === id)?.model ?? id} />
            <Facts
              rows={[
                [t('정격 출력'), `${fmt(ref.ratedPower, 0)} W`],
                [t('정격 / 최대 토크'), `${fmt(ref.ratedTorque)} / ${fmt(ref.peakTorque)} Nm`],
                [t('정격 / 최고 회전수'), `${fmt(ref.ratedSpeed, 0)} / ${fmt(ref.maxSpeed, 0)} rpm`],
                [t('전원 · 인터페이스'), `${supplyOf(ref) ?? '—'} · ${ref.interfaceCode ?? '—'}`],
              ]}
            />
            {offered && (
              <>
                <div className="field">
                  <span className="field-label">{t('축 끝')}</span>
                  <RadioGroup
                    options={['plain', 'key'] as const}
                    value={opts.shaft}
                    onChange={option('shaft')}
                    label={(v) => t(v === 'plain' ? '평축' : '키 축')}
                    disabled={(v) => (offered.shaft.includes(v) ? null : t('이 모델에는 없는 옵션'))}
                  />
                </div>
                <div className="field">
                  <span className="field-label">{t('축 씰')}</span>
                  <RadioGroup
                    options={['no', 'yes'] as const}
                    value={opts.seal ? 'yes' : 'no'}
                    onChange={(v) => option('seal')(v === 'yes')}
                    label={(v) => (ref.maker === 'Siemens' ? t(v === 'yes' ? 'IP65 (씰 있음)' : 'IP64 (씰 없음)') : t(v === 'yes' ? '있음' : '없음'))}
                    disabled={(v) => (offered.seal.includes(v === 'yes') ? null : t('이 모델에는 없는 옵션'))}
                  />
                </div>
                <div className="field">
                  <span className="field-label">{t('엔코더')}</span>
                  <RadioGroup
                    options={['multi', 'single'] as const}
                    value={opts.encoder === 'none' ? 'multi' : opts.encoder}
                    onChange={option('encoder')}
                    label={(v) => t(v === 'single' ? '싱글턴' : '멀티턴')}
                    disabled={(v) => (offered.encoder.includes(v) ? null : t('멀티턴 앱솔루트 엔코더가 표준입니다'))}
                  />
                </div>
              </>
            )}
          </section>
          <section>
            <h2>{t('Festo 제품')}</h2>
            <div className="field">
              <span className="field-label">{t('시리즈')}</span>
              <ToggleGroup options={festoFamilies} selected={families} onChange={setFamilies} />
            </div>
            <div className="field">
              <span className="field-label">{t('전원')}</span>
              <RadioGroup options={supplies} value={supply} onChange={setSupply} label={(s) => (s === 'all' ? t('전체') : s)} />
            </div>
            <ToggleButton label={t('비교 제품과 같은 출력대')} checked={samePower} onChange={setSamePower} />
            <ToggleButton label={t('같은 인터페이스 코드만 ({code})', { code: ref.interfaceCode ?? '—' })} checked={sameInterface} onChange={setSameInterface} />
          </section>
        </div>
      </aside>
      <div className="results">
        <CompareBar reference={reference} festo={festoBar} onExport={start} exporting={exporting} />
        <CandidateTable
          title={t('Festo 대체 제품')}
          note={t('제품 데이터 · 비교 제품과 가까운 순 · {n}개', { n: list.length })}
          rows={list}
          selected={festo?.id ?? null}
          onSelect={setPick}
          columns={[
            { head: t('모델명'), sort: (m) => (offered ? (festoVariant(m, opts).variant?.orderCode ?? m.model) : m.model), cell: (m) => <span className="model">{offered ? (festoVariant(m, opts).variant?.orderCode ?? m.model) : m.model}</span> },
            { head: t('정격 출력'), num: true, sort: (m) => m.ratedPower, cell: (m) => `${fmt(m.ratedPower, 0)} W` },
            { head: t('정격 토크'), num: true, sort: (m) => m.ratedTorque, cell: (m) => `${fmt(m.ratedTorque)} Nm` },
            { head: t('최대 토크'), num: true, sort: (m) => m.peakTorque, cell: (m) => `${fmt(m.peakTorque)} Nm` },
            { head: t('최고 회전수'), num: true, sort: (m) => m.maxSpeed, cell: (m) => `${fmt(m.maxSpeed, 0)} rpm` },
            { head: t('회전자 관성'), num: true, sort: (m) => m.inertia, cell: (m) => `${fmt(m.inertia, 3)} kg·cm²` },
            { head: t('전원'), data: true, sort: (m) => supplyOf(m) ?? null, cell: (m) => supplyOf(m) ?? '—' },
            {
              head: t('인터페이스'),
              data: true,
              sort: (m) => m.interfaceCode ?? null,
              cell: (m) => <span className={m.interfaceCode === ref.interfaceCode ? undefined : 'warn-text'}>{m.interfaceCode ?? '—'}</span>,
            },
          ]}
        />
        {specs && <SpecTable {...specs} />}
        <Footer />
      </div>
      {exporting && festoBar && specs && <CompareReport stageRef={reportRef} kind={t('모터')} reference={reference} festo={festoBar} specs={specs} />}
    </main>
  )
}
