import { useState } from 'react'
import { accelerationForTime, accelTimeFor, minAccelTime } from '../calc/motionProfile'
import {
  defaultParallel,
  defaultPress,
  defaultSettings,
  type Mounting,
  type ParallelConfig,
  type ParallelMode,
  type PressConditions,
  type Requirements,
  type Settings,
} from '../calc/types'
import { useT } from '../i18n'
import cogImage from '../../images/center_of_gravity.png'
import { NumberField, RadioGroup, ToggleButton } from './common'
import { ModeSwitch, type AppMode } from './ModeSwitch'
import { fmt, kgf, mountingLabel, parallelModeLabel, pressDirectionLabel } from './format'

const parallelModeHint: Record<ParallelMode, string> = {
  single: '축 1개로 부하를 지지하고 구동',
  twinMotor: '평행한 축 2개를 모터 2개로 동기 제어. 모터·키트·드라이브는 축 1개 기준 (각 2개)',
  twinShaft: '평행한 축 2개를 모터 1개가 연결축으로 구동. 모터는 두 축 합계 기준',
  guides: '축과 평행한 LM 가이드가 부하를 나눠 지지. 구동은 축 1개',
}

type GuideArrangement = 'one' | 'middle' | 'edge'
const guideArrangementLabel: Record<GuideArrangement, string> = { one: '1개', middle: '2개 · 축 가운데', edge: '2개 · 축 가장자리' }
const guideArrangement = (p: ParallelConfig): GuideArrangement =>
  p.guideCount === 1 ? 'one' : p.guideAxisEdge ? 'edge' : 'middle'

type AccelMode = 'acceleration' | 'time'
const accelModeLabel: Record<AccelMode, string> = { acceleration: '가속도', time: '가속 시간' }

interface Props {
  req: Requirements
  settings: Settings
  onReq: (req: Requirements) => void
  onSettings: (settings: Settings) => void
  mode: AppMode
  onMode: (mode: AppMode) => void
}

export function InputPanel({ req, settings, onReq, onSettings, mode, onMode }: Props) {
  const t = useT()
  const set = <K extends keyof Requirements>(key: K, value: Requirements[K]) => onReq({ ...req, [key]: value })
  const setCog = (axis: 'x' | 'y' | 'z', value: number) => onReq({ ...req, cog: { ...req.cog, [axis]: value } })
  const setS = <K extends keyof Settings>(key: K, value: Settings[K]) => onSettings({ ...settings, [key]: value })
  const press = req.press ?? defaultPress
  const setPress = <K extends keyof PressConditions>(key: K, value: PressConditions[K]) =>
    onReq({ ...req, press: { ...press, [key]: value } })
  const parallel = req.parallel ?? defaultParallel

  // Acceleration can be entered directly or as the time to reach the velocity; the calculation always uses
  // req.acceleration, so in time mode it is re-derived whenever velocity, time or jerk changes.
  const [accelMode, setAccelMode] = useState<AccelMode>('acceleration')
  const [accelTime, setAccelTime] = useState(() => round(accelTimeFor(req.velocity, req.acceleration, req.jerk)))
  const setMotion = (patch: Partial<Pick<Requirements, 'velocity' | 'jerk'>>, time = accelTime) => {
    const next = { ...req, ...patch }
    if (accelMode === 'time') next.acceleration = accelerationForTime(next.velocity, time, next.jerk)
    onReq(next)
  }
  const changeAccelMode = (mode: AccelMode) => {
    if (mode === 'time') setAccelTime(round(accelTimeFor(req.velocity, req.acceleration, req.jerk)))
    else onReq({ ...req, acceleration: round(req.acceleration) })
    setAccelMode(mode)
  }
  const minTime = minAccelTime(req.velocity, req.jerk)

  const setMounting = (mounting: Mounting) => {
    onReq({ ...req, mounting })
    // A vertical axis must not drop the load on power loss.
    const next = { ...settings, requireBrake: mounting === 'vertical' }
    // Pressing on the floor or a wall: an external guide carries the payload by default; vertical: none.
    if (press.enabled) next.externalGuide = mounting !== 'vertical'
    onSettings(next)
  }

  // Pressing defaults to ball screw axes and ESBF (external guide unless vertical); 일반 restores every axis.
  const setApplication = (pressing: boolean) => {
    setPress('enabled', pressing)
    onSettings(
      pressing
        ? { ...settings, drives: ['spindle'], families: ['ESBF'], externalGuide: req.mounting !== 'vertical' }
        : { ...settings, drives: defaultSettings.drives, families: defaultSettings.families, externalGuide: defaultSettings.externalGuide },
    )
  }

  return (
    <aside className="inputs">
      <ModeSwitch mode={mode} onMode={onMode} />
      <div className="panel inputs-main">
        <section>
          <h2>{t('사용 조건')}</h2>
          <div className="field">
            <span className="field-label">{t('축 설치 방향')}</span>
            <RadioGroup
              className=""
              options={Object.keys(mountingLabel) as Mounting[]}
              value={req.mounting}
              onChange={setMounting}
              label={(m) => t(mountingLabel[m])}
            />
          </div>
          <div className="grid-2">
            <NumberField label={t('스트로크')} unit="mm" value={req.stroke} min={1} onChange={(v) => set('stroke', v)} />
            <NumberField label={t('하중')} unit="kg" value={req.payload} onChange={(v) => set('payload', v)} />
          </div>
          <div className="field">
            <span className="field-label">{t('가속 입력')}</span>
            <RadioGroup
              className=""
              options={Object.keys(accelModeLabel) as AccelMode[]}
              value={accelMode}
              onChange={changeAccelMode}
              label={(m) => t(accelModeLabel[m])}
            />
          </div>
          <div className="grid-2">
            <NumberField
              label={t('속도')}
              unit="m/s"
              value={req.velocity}
              min={0.001}
              onChange={(v) => setMotion({ velocity: v })}
            />
            {accelMode === 'acceleration' ? (
              <NumberField
                label={t('가속도')}
                unit="m/s²"
                value={req.acceleration}
                min={0.001}
                onChange={(v) => set('acceleration', v)}
                hint={t('가속 시간 {time} s', { time: fmt(accelTimeFor(req.velocity, req.acceleration, req.jerk), 3) })}
              />
            ) : (
              <NumberField
                label={t('가속 시간')}
                unit="s"
                value={accelTime}
                min={0.001}
                onChange={(time) => {
                  setAccelTime(time)
                  setMotion({}, time)
                }}
                hint={
                  accelTime < minTime
                    ? t('저크 제한으로 최소 {time} s', { time: fmt(minTime, 3) })
                    : t('가속도 {accel} m/s²', { accel: fmt(req.acceleration, 2) })
                }
              />
            )}
            <NumberField label={t('저크')} unit="m/s³" value={req.jerk} onChange={(v) => setMotion({ jerk: v })} />
            <NumberField label={t('휴지 시간')} unit="s" value={settings.dwellTime} onChange={(v) => setS('dwellTime', v)} />
          </div>
        </section>

        <section>
          {/* Three fields in a row are too narrow for a unit inside each: the unit sits in the heading */}
          <h2>
            {t('부하 무게 중심')} <span className="heading-unit">(mm)</span>
          </h2>
          <div className="grid-3">
            <NumberField label="X" value={req.cog.x} min={-1e6} onChange={(v) => setCog('x', v)} />
            <NumberField label="Y" value={req.cog.y} min={-1e6} onChange={(v) => setCog('y', v)} />
            <NumberField label="Z" value={req.cog.z} min={-1e6} onChange={(v) => setCog('z', v)} />
          </div>
          {parallel.mode !== 'single' && (
            <p className="field-hint">{t('Y: 축 구성 중심 기준, +Y = 두 번째 축/가이드 쪽')}</p>
          )}
          <details className="cog-details">
            <summary>{t('무게 중심 입력 가이드')}</summary>
            <img className="cog-image" src={cogImage} alt={t('축 형태별 X, Y, Z 좌표 방향')} />
            <p className="help cog-help">
              {t('슬라이드 중심 기준 거리')}
              <br />
              {t('X = 이동 방향')}
              <br />
              {t('Y = 슬라이드 면의 측면 방향')}
              <br />
              {t('Z = 슬라이드 면에서 위쪽')}
            </p>
          </details>
        </section>
      </div>

      <section className="panel application">
        <h2>{t('어플리케이션 선택')}</h2>
        <RadioGroup
          className=""
          options={['general', 'press'] as const}
          value={press.enabled ? 'press' : 'general'}
          onChange={(a) => setApplication(a === 'press')}
          label={(a) => t(a === 'press' ? '프레싱' : '일반')}
        />
        {!press.enabled && <p className="field-hint application-hint">{t('스트로크를 왕복 이송')}</p>}
        {press.enabled && req.mounting === 'vertical' && (
          <div className="field">
            <span className="field-label">{t('압착 방향')}</span>
            <RadioGroup
              options={['down', 'up'] as const}
              value={press.direction}
              onChange={(v) => setPress('direction', v)}
              label={(v) => t(pressDirectionLabel[v])}
            />
          </div>
        )}
        {press.enabled && (
          <div className="grid-2">
            <NumberField
              label={t('압착력')}
              unit="N"
              value={press.force}
              onChange={(v) => setPress('force', v)}
              hint={kgf(press.force)}
            />
            <NumberField
              label={t('압착 구간')}
              unit="mm"
              value={press.distance}
              min={0.001}
              onChange={(v) => setPress('distance', v)}
            />
            <NumberField
              label={t('압착 속도')}
              unit="m/s"
              value={press.speed}
              min={0.0001}
              onChange={(v) => setPress('speed', v)}
            />
            <NumberField label={t('가압 유지 시간')} unit="s" value={press.holdTime} onChange={(v) => setPress('holdTime', v)} />
          </div>
        )}
      </section>

      <ParallelSection parallel={parallel} onParallel={(p) => onReq({ ...req, parallel: p })} />

      <DetailSettings settings={settings} onSettings={onSettings} />
    </aside>
  )
}

/** 축 구성: single axis, two axes or LM guides, with spacing and the mode's own inputs. */
export function ParallelSection({
  parallel,
  onParallel,
  title = '축 구성',
  spacingNote,
}: {
  parallel: ParallelConfig
  onParallel: (p: ParallelConfig) => void
  title?: string
  /** shown under the spacing (translated), e.g. the gantry's spacing adjusted to its kits */
  spacingNote?: string
}) {
  const t = useT()
  const setParallel = <K extends keyof ParallelConfig>(key: K, value: ParallelConfig[K]) => onParallel({ ...parallel, [key]: value })
  return (
    <section className="panel application">
      <h2>{t(title)}</h2>
      <RadioGroup
        className="segmented-grid"
        options={Object.keys(parallelModeLabel) as ParallelMode[]}
        value={parallel.mode}
        onChange={(m) => setParallel('mode', m)}
        label={(m) => t(parallelModeLabel[m])}
      />
      <p className="field-hint application-hint">{t(parallelModeHint[parallel.mode])}</p>
      {parallel.mode === 'guides' && (
        <div className="field">
          <span className="field-label">{t('LM 가이드 수')}</span>
          <RadioGroup
            className="small wrap"
            options={['one', 'middle', 'edge'] as const}
            value={guideArrangement(parallel)}
            onChange={(v) => onParallel({ ...parallel, guideCount: v === 'one' ? 1 : 2, guideAxisEdge: v === 'edge' })}
            label={(v) => t(guideArrangementLabel[v])}
          />
        </div>
      )}
      {parallel.mode !== 'single' && (
        <div className="grid-2">
          <NumberField
            label={t(parallel.mode === 'guides' ? '축–가이드 간격' : '축 간격')}
            unit="mm"
            value={parallel.spacing}
            min={1}
            onChange={(v) => setParallel('spacing', v)}
          />
          {parallel.mode === 'guides' && (
            <NumberField
              label={t('가이드 1개 이동 질량')}
              unit="kg"
              value={parallel.guideMass}
              onChange={(v) => setParallel('guideMass', v)}
              hint={t('블록 + 브래킷')}
            />
          )}
          {parallel.mode === 'twinShaft' && (
            <NumberField
              label={t('연결축 관성')}
              unit="kg·cm²"
              value={parallel.shaftInertia}
              onChange={(v) => setParallel('shaftInertia', v)}
              hint={t('KSK가 없는 축에만 사용 (KSK는 자동 계산)')}
            />
          )}
        </div>
      )}
      {parallel.mode !== 'single' && spacingNote && <p className="field-hint">{spacingNote}</p>}
    </section>
  )
}

/** The collapsible 상세 설정 box: efficiencies, friction, external forces, inertia, support span, operating hours. */
export function DetailSettings({ settings, onSettings }: { settings: Settings; onSettings: (settings: Settings) => void }) {
  const t = useT()
  const setS = <K extends keyof Settings>(key: K, value: Settings[K]) => onSettings({ ...settings, [key]: value })
  return (
    <details className="panel settings">
      <summary>{t('상세 설정')}</summary>
      <div className="grid-2">
        <NumberField
          label={t('구동 효율 (볼스크류)')}
          value={settings.efficiency.spindle}
          min={0.01}
          onChange={(v) => setS('efficiency', { ...settings.efficiency, spindle: v })}
        />
        <NumberField
          label={t('구동 효율 (벨트)')}
          value={settings.efficiency.belt}
          min={0.01}
          onChange={(v) => setS('efficiency', { ...settings.efficiency, belt: v })}
        />
        <NumberField
          label={t('마찰 계수 (볼스크류)')}
          value={settings.friction.spindle}
          onChange={(v) => setS('friction', { ...settings.friction, spindle: v })}
        />
        <NumberField
          label={t('마찰 계수 (벨트)')}
          value={settings.friction.belt}
          onChange={(v) => setS('friction', { ...settings.friction, belt: v })}
        />
        <NumberField
          label={t('외부 반력 Fc')}
          unit="N"
          value={settings.externalForce}
          onChange={(v) => setS('externalForce', v)}
        />
        <NumberField
          label={t('가이드 저항 FG')}
          unit="N"
          value={settings.guideResistance}
          onChange={(v) => setS('guideResistance', v)}
        />
        <NumberField
          label={t('커플링 관성')}
          unit="kg·cm²"
          value={settings.couplingInertia}
          onChange={(v) => setS('couplingInertia', v)}
        />
        <NumberField
          label={t('기본 허용 관성비')}
          unit={t('배')}
          value={settings.defaultInertiaRatio}
          min={0.1}
          onChange={(v) => setS('defaultInertiaRatio', v)}
          hint={t('모터 데이터에 없을 때')}
        />
        <NumberField
          label={t('지지 간격')}
          unit="mm"
          value={settings.supportSpan}
          onChange={(v) => setS('supportSpan', v)}
          hint={t('0 = 양 끝만 지지')}
        />
        <NumberField
          label={t('일 가동 시간')}
          unit="h"
          value={settings.hoursPerDay}
          min={0.1}
          onChange={(v) => setS('hoursPerDay', v)}
        />
      </div>
      <div className="field">
        <span className="field-label">{t('보수적 판정')}</span>
        <ToggleButton
          label={settings.conservative ? t('켜짐') : t('꺼짐')}
          checked={settings.conservative}
          onChange={(v) => setS('conservative', v)}
        />
        <span className="field-hint">{t('켜면 등속 구간 토크가 정격 토크를 넘을 때 주의 대신 부적합')}</span>
      </div>
    </details>
  )
}

/** Keeps converted values readable in the input (e.g. 0.1 instead of 0.09999999999999999). */
function round(n: number): number {
  return Number(n.toPrecision(6))
}
