import { useState } from 'react'
import { minSlidePitch, slideAxes, type AxisEvaluation } from '../calc/axisSelection'
import { axes } from '../data'
import type { AdditionalSlideSide, Settings } from '../calc/types'
import type { AxisFamily, AxisMounting, DriveKind, SensorContact, SensorMaker, SensorOutput } from '../data/types'
import { CheckTable, CollapseTitle, HelpTip, InfoTable, NumberField, RadioGroup, Ratio, SortTh, StatusBadge, ToggleButton } from './common'
import mountingImage from '../../images/help_axis_mounting.svg'
import { statusRank, useSort } from './useSort'
import { useT } from '../i18n'
import { axisDetailChecks, axisDetailInfo, driveLabel, fmt, guideDetail } from './format'

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
const mountingLabel: Record<'standard' | AxisMounting, string> = { standard: '표준', M: '직접 체결 M', M7: '전면 사용 M7' }

/**
 * Order options of the axes that offer them (additional slide: ELGT-BS, ELGD-TB ZL/ZR, EGC-TB-KF KL/KR; belt: ELGD-TB
 * PU1/PU2, EGC-TB-KF chloroprene/PU2; mounting type: ELGD), shown while such axes are in the list.
 */
function AxisOptionFilters({ settings, onSettings, selected }: Pick<Props, 'settings' | 'onSettings'> & { selected: AxisEvaluation | null }) {
  const t = useT()
  // the spacing cannot go below the slides' own lengths: 0 (the default) shows the selected axis's minimum, a value
  // below it is marked (the calculation takes the minimum)
  const min = selected ? minSlidePitch(selected.axis) : null
  const hint = min != null ? t('최소 {min} mm (선택 축)', { min: fmt(min) }) : t('0 = 최소 간격')
  const display = (pitch: number) => (pitch === 0 && min != null ? min : pitch)
  const low = (pitch: number) => min != null && pitch > 0 && pitch < min
  const choices = slideAxes(axes, settings)
  const shown = settings.drives.includes('belt') ? (['ELGD', 'EGC'] as const).filter((f) => settings.families.includes(f)) : []
  const elgd = settings.families.includes('ELGD')
  // M7 exists on ball screw axes only
  const mountings: ('standard' | AxisMounting)[] = settings.drives.includes('spindle') ? ['standard', 'M', 'M7'] : ['standard', 'M']
  // position sensing (ELGD, ELGT-BS, EGC, ESBF): the switches' output and contacts
  const sensing = settings.sensors && (elgd || (['ELGT', 'EGC', 'ESBF'] as const).some((f) => settings.families.includes(f)))
  const sensorMakers: SensorMaker[] = [
    'Festo',
    ...(elgd || settings.families.includes('ELGT') ? (['Omron'] as const) : []),
    ...(settings.families.includes('EGC') ? (['Festo M8'] as const) : []),
  ]
  if (choices.length === 0 && shown.length === 0 && !elgd && !sensing) return null
  const mounting = settings.axisMounting && mountings.includes(settings.axisMounting) ? settings.axisMounting : 'standard'
  const sides: AdditionalSlideSide[] = choices.some((a) => a.additionalSlide!.both) ? ['none', 'left', 'right', 'both'] : ['none', 'left', 'right']
  return (
    <div className="step-filters axis-options">
      {choices.length > 0 && (
        <div className="filter-group">
          <span className="field-label">{t('추가 슬라이드')}</span>
          <RadioGroup
            options={sides}
            value={sides.includes(settings.additionalSlide) ? settings.additionalSlide : 'none'}
            label={(v) => t(slideLabel[v])}
            onChange={(v) => onSettings({ ...settings, additionalSlide: v })}
          />
        </div>
      )}
      {choices.length > 0 && settings.additionalSlide !== 'none' && sides.includes(settings.additionalSlide) && (
        <div className="filter-group slide-gap">
          <NumberField
            label={settings.additionalSlide === 'both' ? t('슬라이드 중심 간격 ({code})', { code: 'KL' }) : t('슬라이드 중심 간격')}
            unit="mm"
            value={display(settings.slidePitch)}
            step={1}
            hint={hint}
            low={low(settings.slidePitch)}
            onChange={(slidePitch) => onSettings({ ...settings, slidePitch })}
          />
        </div>
      )}
      {choices.length > 0 && settings.additionalSlide === 'both' && sides.includes('both') && (
        <div className="filter-group slide-gap">
          <NumberField
            label={t('슬라이드 중심 간격 ({code})', { code: 'KR' })}
            unit="mm"
            value={display(settings.slidePitchRight)}
            step={1}
            low={low(settings.slidePitchRight)}
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
      {elgd && (
        <div className="filter-group">
          <span className="field-label">
            {t('ELGD 취부')}
            <HelpTip title={t('ELGD 취부')}>
              <img className="help-image" src={mountingImage} alt="" />
              <p>{t('표준: 프로파일 슬롯에 클램핑 조(프로파일 마운팅 EAHF)로 고정합니다.')}</p>
              <p>{t('직접 체결 M: 프로파일 아랫면의 나사와 센터링 구멍으로 바로 고정합니다. 프로파일 마운팅이 필요 없어 공간을 줄이지만, 최대 스트로크가 1000–1400 mm로 줄어듭니다.')}</p>
              <p>{t('전면 사용 M7: 모터 반대쪽 프로파일 아랫면의 나사와 앵글 키트 EAHM-E24-AK로 축 앞쪽에 부착물을 답니다. ELGD-BS 60, 80과 ELGD-BS-WD 100만 해당합니다.')}</p>
              <p>{t('ELGT, EGC에는 취부 방식 옵션이 없습니다. 3D 도면은 M이면 M 사양 모델(아랫면 나사 · 센터링 구멍)로, M7이면 표준 프로파일 모델로 그려집니다.')}</p>
            </HelpTip>
          </span>
          <RadioGroup
            options={mountings}
            value={mounting}
            label={(v) => t(mountingLabel[v])}
            onChange={(v) => onSettings({ ...settings, axisMounting: v === 'standard' ? null : v })}
          />
        </div>
      )}
      {sensing && (
        <div className="axis-options-row">
          {/* Omron EE-SX674 on a Festo sensor bracket: ELGD and ELGT; Festo's round SIEN-M8B on HWS-EGC: EGC-HD */}
          {sensorMakers.length > 1 && (
            <div className="filter-group">
              <span className="field-label">{t('센서 제조사')}</span>
              <RadioGroup
                options={sensorMakers}
                value={settings.sensorMaker}
                label={(v) => (v === 'Festo M8' ? t('Festo M8 (원형)') : v)}
                onChange={(sensorMaker) => onSettings({ ...settings, sensorMaker })}
              />
            </div>
          )}
          <div className="filter-group">
            <span className="field-label">{t('센서 출력')}</span>
            <RadioGroup
              options={['PNP', 'NPN'] as SensorOutput[]}
              value={settings.sensorOutput}
              label={(v) => v}
              onChange={(sensorOutput) => onSettings({ ...settings, sensorOutput })}
            />
          </div>
          <div className="filter-group">
            <span className="field-label">{t('Limit 센서')}</span>
            <RadioGroup
              options={['NO', 'NC'] as SensorContact[]}
              value={settings.limitContact}
              label={(v) => v}
              onChange={(limitContact) => onSettings({ ...settings, limitContact })}
            />
          </div>
          <div className="filter-group">
            <span className="field-label">{t('Home 센서')}</span>
            <RadioGroup
              options={['none', 'NO', 'NC'] as const}
              value={settings.homeContact ?? 'none'}
              label={(v) => (v === 'none' ? t('미사용') : v)}
              onChange={(v) => onSettings({ ...settings, homeContact: v === 'none' ? null : v })}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export function AxisStep({ results, selectedId, onSelect, settings, onSettings }: Props) {
  const t = useT()
  const [showFailed, setShowFailed] = useState(false)
  const [detailOpen, setDetailOpen] = useState(true)
  const [guideOpen, setGuideOpen] = useState(true)
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
  const guide = selected ? guideDetail(selected) : null
  // the ball screw axes have no max. driving torque: the column only when a listed axis has the check
  const torqueColumn = rows.some((e) => e.checks.some((c) => c.label === '구동 토크'))

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
              // ESBF has no belt version: the first family that does comes on
              ...(v === 'belt' && settings.families.includes('ESBF') ? { families: [beltFamilies[0]] } : {}),
            })
          }
        />
        <RadioGroup
          options={shownFamilies}
          value={settings.families.find((f) => shownFamilies.includes(f)) ?? shownFamilies[0]}
          label={(f) => f}
          // both additional slides exist on EGC only
          onChange={(v) =>
            onSettings({
              ...settings,
              families: [v],
              ...(v !== 'EGC' && settings.additionalSlide === 'both' ? { additionalSlide: 'none' } : {}),
            })
          }
        />
        <ToggleButton
          label={t('표준 스트로크')}
          checked={settings.standardStroke}
          onChange={(v) => onSettings({ ...settings, standardStroke: v })}
        />
        {settings.drives.includes('spindle') && settings.families.some((f) => f === 'ELGD' || f === 'EGC') && (
          <ToggleButton
            label={t('스핀들 서포트')}
            checked={settings.spindleSupport}
            onChange={(v) => onSettings({ ...settings, spindleSupport: v })}
          />
        )}
        {(['ELGD', 'ELGT', 'EGC', 'ESBF'] as const).some((f) => settings.families.includes(f)) && (
          <ToggleButton label={t('위치 센서')} checked={settings.sensors} onChange={(v) => onSettings({ ...settings, sensors: v })} />
        )}
      </div>
      <AxisOptionFilters settings={settings} onSettings={onSettings} selected={selected ?? null} />

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
                {torqueColumn && (
                  <SortTh id="torque" {...th}>
                    {t('구동 토크')}
                  </SortTh>
                )}
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
                  {torqueColumn && (
                    <td>
                      <Ratio ratio={ratioOf(e, '구동 토크')} />
                    </td>
                  )}
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
              <InfoList items={axisDetailInfo(selected)} />
            </>
          )}
        </div>
      )}
      {guide && (
        <div className="detail">
          <CollapseTitle open={guideOpen} onToggle={() => setGuideOpen(!guideOpen)}>
            {t('{model} 세부사항', { model: guide.model })}
          </CollapseTitle>
          {guideOpen && (
            <>
              <CheckTable checks={guide.checks} />
              <InfoList items={guide.info} />
            </>
          )}
        </div>
      )}
    </section>
  )
}

function InfoList({ items }: { items: AxisEvaluation['info'] }) {
  const t = useT()
  if (items.length === 0) return null
  return (
    <InfoTable
      rows={items.map((i) => ({
        label: i.label,
        value: `${fmt(i.value, 3)} ${i.unit}`,
        note: i.note && t(i.note, i.noteArgs),
        alert: i.alert,
      }))}
    />
  )
}
