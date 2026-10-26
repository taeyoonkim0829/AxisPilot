import { useState } from 'react'
import type { ParallelLayout } from '../calc/axisSelection'
import type { DriveEvaluation } from '../calc/motorSelection'
import type { Settings, Supply } from '../calc/types'
import { motorFamilies } from '../data'
import type { MotorMaker } from '../data/types'
import { CheckTable, CollapseTitle, RadioGroup, Ratio, SortTh, StatusBadge, ToggleButton, ToggleGroup } from './common'
import { statusRank, useSort } from './useSort'
import { translateData, useLang, useT } from '../i18n'
import { DrivePackage } from './DrivePackage'
import { fmt, statusLabel, supplyLabel } from './format'

interface Props {
  /** One row per motor: direct drive, or with its recommended gearbox when settings.useGearbox */
  results: DriveEvaluation[]
  /** The selected motor with the gearbox actually used (the recommendation unless changed in step 3) */
  selected: DriveEvaluation | null
  onSelect: (id: string) => void
  settings: Settings
  onSettings: (settings: Settings) => void
  /** Axis arrangement of the selected axis (motor count) */
  layout?: ParallelLayout
}

const makers: MotorMaker[] = ['Festo', 'Siemens', 'Mitsubishi']

const supplies: Supply[] = ['ac400', 'ac230', 'dc48']
/** Power supply a maker starts on: the 400 V class for Festo and Siemens, 200 V for Mitsubishi */
const makerSupply: Record<MotorMaker, Supply> = { Festo: 'ac400', Siemens: 'ac400', Mitsubishi: 'ac230' }

const ROW_LIMIT = 60

export function MotorStep({ results, selected, onSelect, settings, onSettings, layout }: Props) {
  const t = useT()
  const lang = useLang()
  const selectedId = selected?.motor.id ?? null
  const [showFailed, setShowFailed] = useState(false)
  const [detailOpen, setDetailOpen] = useState(true)
  const passing = results.filter((r) => r.status !== 'fail')
  const {
    sorted: listed,
    sort,
    toggle,
  } = useSort(showFailed ? results : passing, {
    status: (d) => statusRank[d.status],
    maker: (d) => d.motor.maker,
    model: (d) => d.motor.model,
    power: (d) => d.motor.ratedPower,
    gearbox: (d) => d.gearbox?.ratio ?? 1,
    peak: (d) => d.peakTorque / d.motor.peakTorque,
    rms: (d) => d.rmsTorque / d.motor.ratedTorque,
    speed: (d) => d.maxMotorSpeed / d.motor.ratedSpeed,
    inertia: (d) => d.checks.find((c) => c.label === '관성비')?.ratio ?? null,
    kit: (d) => (d.kit ? statusRank[d.kit.status] : 3),
    controller: (d) => d.controller?.controller?.nominalCurrent ?? null,
  })
  const th = { sort, onSort: toggle }
  const rows = listed.slice(0, ROW_LIMIT)
  const familyOptions = settings.makers.flatMap((m) => motorFamilies[m])
  const excluded = settings.excludedMotorFamilies
  const onMaker = (maker: MotorMaker) => {
    const v = [maker]
    // Never leave every listed family switched off: re-enable the remaining makers' families.
    const options = v.flatMap((m) => motorFamilies[m])
    const all = options.every((f) => excluded.includes(f))
    onSettings({
      ...settings,
      makers: v,
      supplies: [makerSupply[maker]],
      excludedMotorFamilies: all ? excluded.filter((f) => !options.includes(f)) : excluded,
    })
  }

  return (
    <section className="panel step" id="step-motor">
      <header className="step-head">
        <h2>
          <span className="step-no">2</span> {t('모터 선정')}
        </h2>
        <span className="muted">{t('적합 {pass}', { pass: passing.length })}</span>
        {layout?.mode === 'twinMotor' && <span className="muted">{t('모터 2개 (축마다 1개), 부하가 큰 축 기준')}</span>}
        {layout?.mode === 'twinShaft' && <span className="muted">{t('모터 1개가 연결축으로 축 2개 구동')}</span>}
        <label className="toggle small">
          <input type="checkbox" checked={showFailed} onChange={(e) => setShowFailed(e.target.checked)} />
          <span>{t('부적합 포함')}</span>
        </label>
      </header>
      <div className="step-filters">
        <RadioGroup options={makers} value={settings.makers[0] ?? 'Festo'} onChange={onMaker} />
        <RadioGroup
          options={supplies}
          value={settings.supplies[0] ?? 'ac400'}
          onChange={(v) => onSettings({ ...settings, supplies: [v] })}
          label={(v) => supplyLabel[v]}
        />
        <RadioGroup
          options={['direct', 'gearbox'] as const}
          value={settings.useGearbox ? 'gearbox' : 'direct'}
          onChange={(v) => onSettings({ ...settings, useGearbox: v === 'gearbox' })}
          label={(v) => t(v === 'gearbox' ? '감속기 사용' : '감속기 미사용')}
        />
        <ToggleButton
          label={t('브레이크 모터만')}
          checked={settings.requireBrake}
          onChange={(v) => onSettings({ ...settings, requireBrake: v })}
        />
      </div>
      <div className="step-filters">
        <ToggleGroup
          options={familyOptions}
          selected={familyOptions.filter((f) => !excluded.includes(f))}
          onChange={(v) =>
            onSettings({
              ...settings,
              excludedMotorFamilies: [
                ...excluded.filter((f) => !familyOptions.includes(f)),
                ...familyOptions.filter((f) => !v.includes(f)),
              ],
            })
          }
        />
      </div>

      {rows.length === 0 ? (
        <p className="empty">
          {settings.useGearbox
            ? t('조건을 만족하는 모터가 없습니다. 감속기 데이터가 있는 모터만 검토합니다. 다른 축이나 감속기 미사용을 선택해 보세요.')
            : t('조건을 만족하는 모터가 없습니다. 감속기 사용을 선택하거나 다른 축을 선택해 보세요.')}
        </p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <SortTh id="status" {...th}>
                  {t('판정')}
                </SortTh>
                <SortTh id="maker" {...th}>
                  {t('메이커')}
                </SortTh>
                <SortTh id="model" {...th}>
                  {t('모델명')}
                </SortTh>
                <SortTh id="power" num {...th}>
                  {t('정격 출력')}
                </SortTh>
                {settings.useGearbox && (
                  <SortTh id="gearbox" {...th}>
                    {t('추천 감속기')}
                  </SortTh>
                )}
                <SortTh id="peak" {...th}>
                  {t('최대 토크')}
                </SortTh>
                <SortTh id="rms" {...th}>
                  {t('실효 토크')}
                </SortTh>
                <SortTh id="speed" {...th}>
                  {t('회전수')}
                </SortTh>
                <SortTh id="inertia" {...th}>
                  {t('관성비')}
                </SortTh>
                <SortTh id="kit" {...th}>
                  {t('연결키트')}
                </SortTh>
                <SortTh id="controller" {...th}>
                  {t('드라이브')}
                </SortTh>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const inertia = d.checks.find((c) => c.label === '관성비')
                return (
                  <tr
                    key={d.motor.id}
                    className={d.motor.id === selectedId ? 'selected' : ''}
                    onClick={() => onSelect(d.motor.id)}
                    tabIndex={0}
                    onKeyDown={(k) => k.key === 'Enter' && onSelect(d.motor.id)}
                  >
                    <td>
                      <StatusBadge status={d.status} />
                    </td>
                    <td>{d.motor.maker}</td>
                    <td className="model">
                      {d.motor.model}
                      {d.motor.brake && <span className="tag">{t('브레이크')}</span>}
                    </td>
                    <td className="num">{d.motor.ratedPower ? `${fmt(d.motor.ratedPower, 0)} W` : '—'}</td>
                    {settings.useGearbox && (
                      <td className="model">{d.gearbox ? `${d.gearbox.model} (${d.gearbox.ratio}:1)` : '—'}</td>
                    )}
                    <td>
                      <Ratio ratio={d.peakTorque / d.motor.peakTorque} />
                    </td>
                    <td>
                      <Ratio ratio={d.rmsTorque / d.motor.ratedTorque} />
                    </td>
                    <td>
                      <SpeedRatio drive={d} />
                    </td>
                    <td>
                      <Ratio ratio={inertia?.ratio ?? null} />
                    </td>
                    <td>
                      <KitCell drive={d} />
                    </td>
                    <td className="model muted">{d.controller?.controller?.model.replace(/-MP-S\d$/, '') ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {listed.length > ROW_LIMIT && <p className="muted small-print">{t('상위 {n}개만 표시합니다.', { n: ROW_LIMIT })}</p>}
        </div>
      )}

      {selected && (
        <div className="detail">
          <CollapseTitle open={detailOpen} onToggle={() => setDetailOpen(!detailOpen)}>
            {t('{model} 세부사항', {
              model: selected.motor.model + (selected.gearbox ? ` + ${selected.gearbox.model}` : ''),
            })}
          </CollapseTitle>
          {detailOpen && (
            <>
              <CheckTable checks={selected.checks} />
              <p className="muted small-print">
                {selected.kit
                  ? t('연결키트 {kit}: {status} — 판정에 포함 (4단계에서 세부 확인)', {
                      kit: selected.kit.kit.product,
                      status: t(statusLabel[selected.kit.status]),
                    })
                  : t('맞는 연결키트가 없어 주의로 판정합니다.')}
              </p>
              {selected.controller && (
                <DrivePackage
                  selection={selected.controller}
                  cableLength={settings.cableLength}
                  onCableLength={(cableLength) => onSettings({ ...settings, cableLength })}
                />
              )}
              <dl className="info">
                {selected.motor.orderCode && (
                  <div>
                    <dt>{t('주문 형식 / 주문번호')}</dt>
                    <dd>
                      {selected.motor.orderCode} / {selected.motor.partNumber ?? '—'}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>{t('시리즈')}</dt>
                  <dd>{translateData(lang, [selected.motor.series, selected.motor.description].filter(Boolean).join(' · ')) || '—'}</dd>
                </div>
                <div>
                  <dt>{t('정격 / 최대 토크')}</dt>
                  <dd>
                    {fmt(selected.motor.ratedTorque, 3)} / {fmt(selected.motor.peakTorque, 3)} Nm
                  </dd>
                </div>
                <div>
                  <dt>{t('로터 관성')}</dt>
                  <dd>{fmt(selected.motor.inertia, 4)} kg·cm²</dd>
                </div>
                {selected.motor.amplifier && (
                  <div>
                    <dt>{t('앰프')}</dt>
                    <dd>{selected.motor.amplifier}</dd>
                  </div>
                )}
              </dl>
            </>
          )}
        </div>
      )}
    </section>
  )
}

/** The recommended kit's verdict and name, or that no kit fits */
function KitCell({ drive }: { drive: DriveEvaluation }) {
  const t = useT()
  if (!drive.kit) {
    return (
      <span className="kit-cell">
        <StatusBadge status="warn" dot />
        <span className="muted">{t('해당 키트 없음')}</span>
      </span>
    )
  }
  return (
    <span className="kit-cell" title={drive.kit.kit.product}>
      <StatusBadge status={drive.kit.status} dot />
      <span className="muted">{drive.kit.kit.product}</span>
    </span>
  )
}

/**
 * Motor speed as a share of the rated speed. Above rated speed is only a warning
 * (torque drops); above the maximum speed fails.
 */
export function SpeedRatio({ drive }: { drive: DriveEvaluation }) {
  const ratio = drive.maxMotorSpeed / drive.motor.ratedSpeed
  const overMax = drive.checks.some(
    (c) => (c.label === '최대 회전수' || c.label === '감속기 최대 입력 회전수') && c.status === 'fail',
  )
  return <Ratio ratio={ratio} status={overMax ? 'fail' : ratio > 1 ? 'warn' : undefined} />
}
