import { useState } from 'react'
import type { AxisEvaluation } from '../calc/axisSelection'
import type { AdditionalSlideSide, Settings } from '../calc/types'
import type { AxisFamily, DriveKind } from '../data/types'
import { CheckTable, CollapseTitle, NumberField, RadioGroup, Ratio, SortTh, StatusBadge, ToggleButton, ToggleGroup } from './common'
import { statusRank, useSort } from './useSort'
import { useT } from '../i18n'
import { axisDetailChecks, driveLabel, fmt } from './format'

interface Props {
  results: AxisEvaluation[]
  selectedId: string | null
  onSelect: (id: string) => void
  settings: Settings
  onSettings: (settings: Settings) => void
}

const families: AxisFamily[] = ['ELGT', 'ELGD', 'EGC', 'ESBF']
/** ESBF (electric cylinder) has no belt version */
const beltFamilies: AxisFamily[] = ['ELGT', 'ELGD', 'EGC']
const drives: DriveKind[] = ['spindle', 'belt']

const ratioOf = (e: AxisEvaluation, label: string) => e.checks.find((c) => c.label === label)?.ratio ?? null
/** Feed force column: the tighter of Fx and, for electric cylinders, the buckling limit */
const forceRatio = (e: AxisEvaluation) => {
  const r = [ratioOf(e, '이송력 Fx'), ratioOf(e, '압축력 (좌굴)')].filter((x) => x != null)
  return r.length ? Math.max(...r) : null
}
/** Guide column: fv, or the piston rod lateral force for electric cylinders */
const guideRatio = (e: AxisEvaluation) => ratioOf(e, '가이드 하중 비교값 fv') ?? ratioOf(e, '로드 횡하중 Fq')

const slideLabel: Record<AdditionalSlideSide, string> = { none: '없음', left: '좌측', right: '우측', both: '양쪽' }
/** Belt materials offered per family (`Axis.beltMaterials`; CR = EGC chloroprene rubber, no type code) */
const beltOptions = { ELGD: ['PU2', 'PU1'], EGC: ['CR', 'PU2'] } as const
const beltLabel: Record<string, string> = { PU2: 'PU2', PU1: 'PU1 FDA', CR: '클로로프렌' }

/**
 * Order options of the toothed belt axes that offer them (ELGD-TB: ZL/ZR, PU1/PU2; EGC-TB-KF: KL/KR, chloroprene/PU2),
 * shown while such axes are in the list; other axes keep their standard version.
 */
function AxisOptionFilters({ settings, onSettings }: Pick<Props, 'settings' | 'onSettings'>) {
  const t = useT()
  const shown = (['ELGD', 'EGC'] as const).filter((f) => settings.families.includes(f))
  if (!settings.drives.includes('belt') || shown.length === 0) return null
  const sides: AdditionalSlideSide[] = shown.includes('EGC') ? ['none', 'left', 'right', 'both'] : ['none', 'left', 'right']
  return (
    <div className="step-filters axis-options">
      <div className="filter-group">
        <span className="field-label">{t('추가 슬라이드')}</span>
        <RadioGroup
          options={sides}
          value={sides.includes(settings.additionalSlide) ? settings.additionalSlide : 'none'}
          label={(v) => t(slideLabel[v])}
          onChange={(v) => onSettings({ ...settings, additionalSlide: v })}
        />
      </div>
      {settings.additionalSlide !== 'none' && sides.includes(settings.additionalSlide) && (
        <div className="filter-group slide-gap">
          <NumberField
            label={settings.additionalSlide === 'both' ? t('슬라이드 중심 간격 ({code})', { code: 'KL' }) : t('슬라이드 중심 간격')}
            unit="mm"
            value={settings.slidePitch}
            step={1}
            hint={t('0 = 최소 간격')}
            onChange={(slidePitch) => onSettings({ ...settings, slidePitch })}
          />
        </div>
      )}
      {settings.additionalSlide === 'both' && sides.includes('both') && (
        <div className="filter-group slide-gap">
          <NumberField
            label={t('슬라이드 중심 간격 ({code})', { code: 'KR' })}
            unit="mm"
            value={settings.slidePitchRight}
            step={1}
            onChange={(slidePitchRight) => onSettings({ ...settings, slidePitchRight })}
          />
        </div>
      )}
      {shown.map((family) => (
        <div className="filter-group" key={family}>
          <span className="field-label">{t('{family} 벨트', { family })}</span>
          <RadioGroup
            options={beltOptions[family]}
            value={settings.beltMaterial[family] ?? 'CR'}
            label={(v) => t(beltLabel[v])}
            onChange={(v) => onSettings({ ...settings, beltMaterial: { ...settings.beltMaterial, [family]: v === 'CR' ? null : v } })}
          />
        </div>
      ))}
    </div>
  )
}

export function AxisStep({ results, selectedId, onSelect, settings, onSettings }: Props) {
  const t = useT()
  const [showFailed, setShowFailed] = useState(false)
  const [detailOpen, setDetailOpen] = useState(true)
  const passing = results.filter((r) => r.status !== 'fail')
  const shownFamilies = settings.drives.includes('spindle') ? families : beltFamilies
  const {
    sorted: rows,
    sort,
    toggle,
  } = useSort(showFailed ? results : passing, {
    status: (e) => statusRank[e.status],
    model: (e) => e.order.model,
    drive: (e) => driveLabel[e.axis.drive],
    mass: (e) => e.axisMass,
    speed: (e) => ratioOf(e, '속도'),
    accel: (e) => ratioOf(e, '가속도'),
    force: forceRatio,
    torque: (e) => ratioOf(e, '구동 토크'),
    fv: guideRatio,
  })
  const th = { sort, onSort: toggle }
  const selected = results.find((r) => r.axis.id === selectedId)

  return (
    <section className="panel step" id="step-axis">
      <header className="step-head">
        <h2>
          <span className="step-no">1</span> {t('직교 축 선정')}
        </h2>
        <span className="muted">
          {t('적합 {pass} / 검토 {total}', { pass: passing.length, total: results.length })}
        </span>
        <label className="toggle small">
          <input type="checkbox" checked={showFailed} onChange={(e) => setShowFailed(e.target.checked)} />
          <span>{t('부적합 포함')}</span>
        </label>
      </header>
      <div className="step-filters">
        <RadioGroup
          options={drives}
          value={settings.drives[0] ?? 'spindle'}
          label={(d) => t(driveLabel[d])}
          onChange={(v) =>
            onSettings({
              ...settings,
              drives: [v],
              // belt, with ESBF the only family on: the belt families come on
              ...(v === 'belt' && settings.families.every((f) => f === 'ESBF')
                ? { families: [...beltFamilies, ...settings.families] }
                : {}),
            })
          }
        />
        <ToggleGroup
          options={shownFamilies}
          selected={settings.families.filter((f) => shownFamilies.includes(f))}
          // a hidden ESBF keeps its setting; both additional slides exist on EGC only
          onChange={(v) =>
            onSettings({
              ...settings,
              families: [...v, ...settings.families.filter((f) => !shownFamilies.includes(f))],
              ...(!v.includes('EGC') && settings.additionalSlide === 'both' ? { additionalSlide: 'none' } : {}),
            })
          }
        />
        {shownFamilies.includes('ESBF') && settings.families.includes('ESBF') && (
          <ToggleButton
            label={t('ESBF 외부 가이드 사용')}
            checked={settings.externalGuide}
            onChange={(v) => onSettings({ ...settings, externalGuide: v })}
          />
        )}
        <ToggleButton
          label={t('표준 스트로크')}
          checked={settings.standardStroke}
          onChange={(v) => onSettings({ ...settings, standardStroke: v })}
        />
      </div>
      <AxisOptionFilters settings={settings} onSettings={onSettings} />

      {rows.length === 0 ? (
        <p className="empty">{t('조건을 만족하는 축이 없습니다. 부적합 포함을 켜서 초과 항목을 확인하세요.')}</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <SortTh id="status" {...th}>
                  {t('판정')}
                </SortTh>
                <SortTh id="model" {...th}>
                  {t('모델명')}
                </SortTh>
                <SortTh id="drive" {...th}>
                  {t('구동')}
                </SortTh>
                <SortTh id="mass" num {...th}>
                  {t('축 질량')}
                </SortTh>
                <SortTh id="speed" {...th}>
                  {t('속도')}
                </SortTh>
                <SortTh id="accel" {...th}>
                  {t('가속도')}
                </SortTh>
                <SortTh id="force" {...th}>
                  {t('이송력')}
                </SortTh>
                <SortTh id="torque" {...th}>
                  {t('구동 토크')}
                </SortTh>
                <SortTh id="fv" {...th}>
                  {t('가이드 fv')}
                </SortTh>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr
                  key={e.axis.id}
                  className={e.axis.id === selectedId ? 'selected' : ''}
                  onClick={() => onSelect(e.axis.id)}
                  tabIndex={0}
                  onKeyDown={(k) => k.key === 'Enter' && onSelect(e.axis.id)}
                >
                  <td>
                    <StatusBadge status={e.status} />
                  </td>
                  <td className="model">{e.order.model}</td>
                  <td>{t(driveLabel[e.axis.drive])}</td>
                  <td className="num">{fmt(e.axisMass, 1)} kg</td>
                  <td>
                    <Ratio ratio={ratioOf(e, '속도')} />
                  </td>
                  <td>
                    <Ratio ratio={ratioOf(e, '가속도')} />
                  </td>
                  <td>
                    <Ratio ratio={forceRatio(e)} />
                  </td>
                  <td>
                    <Ratio ratio={ratioOf(e, '구동 토크')} />
                  </td>
                  <td>
                    <Ratio ratio={guideRatio(e)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="detail">
          <CollapseTitle open={detailOpen} onToggle={() => setDetailOpen(!detailOpen)}>
            {t('{model} 세부사항', { model: selected.order.model })}
          </CollapseTitle>
          {detailOpen && (
            <>
              <CheckTable checks={axisDetailChecks(selected)} />
              <dl className="info">
                {selected.info.map((i) => (
                  <div key={i.label}>
                    <dt>{t(i.label)}</dt>
                    <dd className={i.alert ? 'fail-text' : undefined}>
                      {fmt(i.value, 3)} {i.unit}
                      {i.note && <span className="muted"> ({t(i.note, i.noteArgs)})</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </div>
      )}
    </section>
  )
}
