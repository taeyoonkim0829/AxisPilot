import { useState, type ReactNode } from 'react'
import {
  axisCandidates,
  axisSpecRows,
  COMPARE_AXIS_FAMILIES,
  motorCandidates,
  motorSpecRows,
  supplyOf,
  type SpecRow,
  type SupplyClass,
} from '../calc/compare'
import { axes, motorFamilies, motors, thirdPartyAxes } from '../data'
import type { Axis, AxisFamily, Motor, ThirdPartyAxis } from '../data/types'
import { useT } from '../i18n'
import { RadioGroup, ToggleButton, ToggleGroup } from './common'
import { Footer } from './Footer'
import { fmt, pct } from './format'

/**
 * 제품 비교: another maker's product (the reference, picked by maker, series and model) and the Festo products that
 * could replace it, from their data alone. Left: the reference and the candidate filters; right: the pair, the
 * candidates (closest first, a row picks one) and the data side by side with the Festo value against the
 * reference's as a gauge (reference = 100%).
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
function CompareBar({ reference, festo }: { reference: { maker: string; model: string; line: string }; festo: { model: string; line: string } | null }) {
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
    </div>
  )
}

/** The other maker's value against the Festo product's: a 0–200% bar with the Festo value (100%) marked */
function Gauge({ ratio }: { ratio: number | null }) {
  const t = useT()
  if (ratio == null) return <span className="gauge-none muted">{t('수치 비교 없음')}</span>
  return (
    <span className="gauge">
      <span className="gauge-fill" style={{ width: `${(Math.min(ratio, 2) / 2) * 100}%` }} />
      <span className="gauge-mark" />
      <span className="gauge-text">{pct(ratio)}</span>
    </span>
  )
}

const cell = (v: number | string | null, unit: string) => (v == null ? '—' : typeof v === 'number' ? `${fmt(v, 3)}${unit ? ` ${unit}` : ''}` : v)

function SpecTable({ rows, reference, festo }: { rows: SpecRow[]; reference: string; festo: string }) {
  const t = useT()
  return (
    <section className="panel step">
      <header className="step-head">
        <h2>{t('사양 비교')}</h2>
      </header>
      <div className="table-wrap">
        <table className="data-table compare-spec">
          <thead>
            <tr>
              <th>{t('항목')}</th>
              <th className="num">
                <span className="model">{reference}</span>
              </th>
              <th className="gauge-head">{t('수치 비교')}</th>
              <th>
                <span className="model">{festo}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>{t(r.label)}</td>
                <td className="num">{cell(r.reference, t(r.unit))}</td>
                <td className="gauge-cell">
                  <Gauge ratio={r.ratio} />
                </td>
                <td className="num spec-other">{cell(r.other, t(r.unit))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
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
  columns: { head: string; cell: (r: T) => ReactNode; num?: boolean; data?: boolean }[]
}) {
  const t = useT()
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
                  <th key={c.head} className={c.num ? 'num' : undefined}>
                    {c.head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
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
  const [families, setFamilies] = useState<AxisFamily[]>(COMPARE_AXIS_FAMILIES)
  const [atLeast, setAtLeast] = useState(true)
  const [pick, setPick] = useState<string | null>(null)
  const list = axisCandidates(ref, axes, { drive: ref.drive, families, atLeast })
  const festo = picked(list, pick)

  return (
    <main className="layout">
      <aside className="inputs">
        <div className="panel inputs-main">
          <section>
            <h2>{t('비교 제품')}</h2>
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
            <p className="field-hint">{t('리니어 모터 타입(RF)은 목록에 없습니다.')}</p>
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
        <CompareBar
          reference={{ maker: ref.maker, model: ref.model, line: axisLine(ref, t) }}
          festo={festo ? { model: festo.model, line: axisLine(festo, t) } : null}
        />
        <CandidateTable
          title={t('Festo 대체 제품')}
          note={t('제품 데이터 · 비교 제품과 가까운 순 · {n}개', { n: list.length })}
          rows={list}
          selected={festo?.id ?? null}
          onSelect={setPick}
          columns={[
            { head: t('모델명'), cell: (a) => <span className="model">{a.model}</span> },
            { head: t('최대 스트로크'), num: true, cell: (a) => `${fmt(a.maxStroke, 0)} mm` },
            { head: t('최고 속도'), num: true, cell: (a) => `${fmt(a.maxSpeed, 3)} m/s` },
            ...(ref.drive === 'spindle'
              ? [{ head: t('볼스크류'), num: true, cell: (a: Axis) => (a.spindleDiameter ? `Ø${a.spindleDiameter} × ${a.spindlePitch}` : '—') }]
              : [{ head: t('피드 상수'), num: true, cell: (a: Axis) => (a.feedConstant ? `${fmt(a.feedConstant)} mm/rev` : '—') }]),
            { head: t('최대 이송력'), num: true, cell: (a) => (a.maxFeedForce ? `${fmt(a.maxFeedForce, 0)} N` : '—') },
            { head: 'Fy / Fz', num: true, cell: (a) => (a.FyMax != null && a.FzMax != null ? `${fmt(a.FyMax, 0)} / ${fmt(a.FzMax, 0)} N` : '—') },
            { head: t('속도 비교'), num: true, cell: (a) => pct(ref.maxSpeed / a.maxSpeed) },
          ]}
        />
        {festo && <SpecTable rows={axisSpecRows(ref, festo)} reference={ref.model} festo={festo.model} />}
        <Footer />
      </div>
    </main>
  )
}

// ---------- 모터 ----------

const thirdPartyMakers = ['Siemens', 'Mitsubishi', 'LS'] as const
const supplies: (SupplyClass | 'all')[] = ['all', 'AC 380–480 V', 'AC 200–240 V']
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
  const list = motorCandidates(ref, motors, { families, supply: supply === 'all' ? null : supply, samePower, sameInterface })
  const festo = picked(list, pick)

  return (
    <main className="layout">
      <aside className="inputs">
        <div className="panel inputs-main">
          <section>
            <h2>{t('비교 제품')}</h2>
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
        <CompareBar reference={{ maker: ref.maker, model: ref.model, line: motorLine(ref) }} festo={festo ? { model: festo.model, line: motorLine(festo) } : null} />
        <CandidateTable
          title={t('Festo 대체 제품')}
          note={t('제품 데이터 · 비교 제품과 가까운 순 · {n}개', { n: list.length })}
          rows={list}
          selected={festo?.id ?? null}
          onSelect={setPick}
          columns={[
            { head: t('모델명'), cell: (m) => <span className="model">{m.model}</span> },
            { head: t('정격 출력'), num: true, cell: (m) => `${fmt(m.ratedPower, 0)} W` },
            { head: t('정격 토크'), num: true, cell: (m) => `${fmt(m.ratedTorque)} Nm` },
            { head: t('최대 토크'), num: true, cell: (m) => `${fmt(m.peakTorque)} Nm` },
            { head: t('최고 회전수'), num: true, cell: (m) => `${fmt(m.maxSpeed, 0)} rpm` },
            { head: t('회전자 관성'), num: true, cell: (m) => `${fmt(m.inertia, 3)} kg·cm²` },
            { head: t('전원'), data: true, cell: (m) => supplyOf(m) ?? '—' },
            {
              head: t('인터페이스'),
              data: true,
              cell: (m) => <span className={m.interfaceCode === ref.interfaceCode ? undefined : 'warn-text'}>{m.interfaceCode ?? '—'}</span>,
            },
          ]}
        />
        {festo && <SpecTable rows={motorSpecRows(ref, festo)} reference={ref.model} festo={festo.model} />}
        <Footer />
      </div>
    </main>
  )
}
