import { gantryAxes, gantryBase, gantryChain, type AxisMotion, type GantryAxis, type GantryConfig, type GantryInputs, type GantrySettings, type Vec, type ZMode } from '../calc/gantry'
import type { Settings } from '../calc/types'
import { useT } from '../i18n'
import { NumberField, RadioGroup } from './common'
import { ModeSwitch, type AppMode } from './ModeSwitch'
import { fmt, mountingLabel } from './format'
import { DetailSettings, ParallelSection } from './InputPanel'
import { accelTimeFor, sCurveShare } from '../calc/motionProfile'

const configHint: Record<GantryConfig, string> = {
  xyz: 'X축(바닥) 위에 Y축, Y축 슬라이드에 수직 Z축',
  yz: 'Y축 슬라이드에 수직 Z축 (라인 겐트리)',
  xy: 'X축(바닥) 위에 Y축 (평면 겐트리), 부하는 Y축 슬라이드에',
}
const zModeLabel: Record<ZMode, string> = { slide: '슬라이드 이동', profile: '프로파일 이동' }
const zModeHint: Record<ZMode, string> = {
  slide: 'Z축 본체를 Y 슬라이드에 고정하고 Z 슬라이드가 움직임',
  profile: 'Z 슬라이드를 Y 슬라이드에 고정하고 축 본체·모터·키트가 함께 움직임',
}

/** Settings shared by every axis of the gantry (상세 설정 and the dwell); the step filters stay per axis. */
const sharedKeys = [
  'dwellTime',
  'efficiency',
  'friction',
  'externalForce',
  'guideResistance',
  'couplingInertia',
  'defaultInertiaRatio',
  'supportSpan',
  'hoursPerDay',
  'conservative',
] as const satisfies (keyof Settings)[]

interface Props {
  gantry: GantryInputs
  onGantry: (g: GantryInputs) => void
  settings: GantrySettings
  onSettings: (s: GantrySettings) => void
  mode: AppMode
  onMode: (mode: AppMode) => void
  /** two base axes: the spacing the calculation uses, set to fit the gantry kits */
  baseSpacing?: { entered: number; used: number }
}

export function GantryInputPanel({ gantry, onGantry, settings, onSettings, mode, onMode, baseSpacing }: Props) {
  const t = useT()
  const chain = gantryChain(gantry.config)
  // the base axis can be a parallel arrangement (X, or Y in yz); the axis it carries
  const base = gantryBase(gantry.config)
  const parallel = gantry.parallel[base]
  const twinBase = parallel.mode !== 'single'
  // inputs in X, Y, Z order; the selection runs from the tool end (`chain`)
  const axes = gantryAxes(gantry.config)
  const set = <K extends keyof GantryInputs>(key: K, value: GantryInputs[K]) => onGantry({ ...gantry, [key]: value })
  const setMotion = (a: GantryAxis, key: keyof AxisMotion, value: number) =>
    set('motion', { ...gantry.motion, [a]: { ...gantry.motion[a], [key]: value } })
  const shared = settings[chain[0]]
  const setShared = (next: Settings) => {
    const patch = Object.fromEntries(sharedKeys.map((k) => [k, next[k]])) as Partial<Settings>
    onSettings({ x: { ...settings.x, ...patch }, y: { ...settings.y, ...patch }, z: { ...settings.z, ...patch } })
  }
  const toolRef =
    gantry.config === 'xy'
      ? t('Y축 슬라이드 중심 기준')
      : gantry.zMode === 'profile'
        ? t('Z축 프로파일 끝단 중심 기준')
        : t('Z축 슬라이드 중심 기준')

  return (
    <aside className="inputs">
      <ModeSwitch mode={mode} onMode={onMode} />
      <div className="panel inputs-main">
        <section>
          <h2>{t('조합축 구성')}</h2>
          <RadioGroup options={['xyz', 'yz', 'xy'] as const} value={gantry.config} onChange={(v) => set('config', v)} label={(v) => v.toUpperCase()} />
          <p className="field-hint application-hint">{t(configHint[gantry.config])}</p>
        </section>

        <section>
          <h2>{t('부하')}</h2>
          <div className="grid-2">
            <NumberField label={t('하중')} unit="kg" value={gantry.payload} onChange={(v) => set('payload', v)} />
          </div>
          <h2 className="subhead">
            {t('부하 무게 중심')} <span className="heading-unit">(mm)</span>
          </h2>
          <VecFields value={gantry.cog} onChange={(v) => set('cog', v)} />
          <p className="field-hint">{t('{ref}, 장비 좌표 X / Y / Z (+Z = 아래쪽)', { ref: toolRef })}</p>
        </section>

        <section>
          <h2>{t('축별 운전 조건')}</h2>
          {axes.map((a) => {
            const m = gantry.motion[a]
            return (
              <div key={a} className="gantry-motion">
                <h3 aria-label={t('{axis}축', { axis: a.toUpperCase() })}>
                  <span className="step-no">{a.toUpperCase()}</span>
                </h3>
                <div className="grid-2">
                  <NumberField label={t('스트로크')} unit="mm" value={m.stroke} min={1} onChange={(v) => setMotion(a, 'stroke', v)} />
                  <NumberField label={t('속도')} unit="m/s" value={m.velocity} min={0.001} onChange={(v) => setMotion(a, 'velocity', v)} />
                  <NumberField
                    label={t('가속도')}
                    unit="m/s²"
                    value={m.acceleration}
                    min={0.001}
                    onChange={(v) => setMotion(a, 'acceleration', v)}
                    hint={t('가속 시간 {time} s', { time: fmt(accelTimeFor(m.velocity, m.acceleration, m.jerk), 3) })}
                  />
                  <NumberField
                    label={t('저크')}
                    unit="m/s³"
                    value={m.jerk}
                    onChange={(v) => setMotion(a, 'jerk', v)}
                    hint={t('S-커브 {pct}%', { pct: fmt(sCurveShare(m.velocity, m.acceleration, m.jerk) * 100, 0) })}
                  />
                </div>
              </div>
            )
          })}
          <div className="grid-2">
            <NumberField
              label={t('휴지 시간')}
              unit="s"
              value={shared.dwellTime}
              onChange={(v) => setShared({ ...shared, dwellTime: v })}
              hint={t('축마다 왕복 후 1회')}
            />
          </div>
        </section>
      </div>

      <section className="panel application">
        <h2>{t('축 설치')}</h2>
        {chain.includes('x') && (
          <div className="field">
            <span className="field-label">{t('X축 설치 방향')}</span>
            <RadioGroup options={['floor', 'wall'] as const} value={gantry.xMounting} onChange={(v) => set('xMounting', v)} label={(v) => t(mountingLabel[v])} />
          </div>
        )}
        <div className="field">
          <span className="field-label">{t('Y축 설치 방향')}</span>
          <RadioGroup options={['floor', 'wall'] as const} value={gantry.yMounting} onChange={(v) => set('yMounting', v)} label={(v) => t(mountingLabel[v])} />
          <span className="field-hint">{t(gantry.yMounting === 'floor' ? '슬라이드 면이 위쪽' : '슬라이드 면이 X 방향 (측면 설치)')}</span>
        </div>
        {chain.includes('z') && (
          <div className="field">
            <span className="field-label">{t('Z축 이동 방식')}</span>
            <RadioGroup options={['slide', 'profile'] as const} value={gantry.zMode} onChange={(v) => set('zMode', v)} label={(v) => t(zModeLabel[v])} />
            <span className="field-hint">{t(zModeHint[gantry.zMode])}</span>
          </div>
        )}
      </section>

      <ParallelSection
        parallel={parallel}
        onParallel={(p) => set('parallel', { ...gantry.parallel, [base]: p })}
        title={base === 'x' ? 'X축 구성' : 'Y축 구성'}
        spacingNote={
          baseSpacing
            ? t('조합 키트에 맞춰 {used} mm로 자동 조정해 계산합니다(키트끼리 간섭 없이 {axis}축이 두 키트에 맞는 간격, 입력 {entered} mm).', {
                used: fmt(baseSpacing.used, 1),
                entered: fmt(baseSpacing.entered, 1),
                axis: chain[chain.length - 2].toUpperCase(),
              })
            : undefined
        }
      />

      <details className="panel settings">
        <summary>{t('질량 · 장착 위치')}</summary>
        <p className="field-hint gantry-note">
          {t('상위 축 하중에 들어가는 값입니다. 모터 질량은 모터 데이터에 질량이 없을 때 사용합니다 (Festo · Siemens).')}
        </p>
        <div className="grid-2">
          {axes.map((a) => (
            <NumberField
              key={a}
              label={t('{axis}축 모터 질량', { axis: a.toUpperCase() })}
              unit="kg"
              value={gantry.motorMass[a]}
              onChange={(v) => set('motorMass', { ...gantry.motorMass, [a]: v })}
            />
          ))}
        </div>
        {chain.includes('z') && (
          <>
            <h3 className="subhead">
              {t('Z축 장착 위치')} <span className="heading-unit">(mm)</span>
            </h3>
            <VecFields value={gantry.offsets.yz} onChange={(v) => set('offsets', { ...gantry.offsets, yz: v })} />
            <p className="field-hint">
              {t(
                base === 'y' && twinBase
                  ? gantry.zMode === 'profile'
                    ? 'Y축 구성 중심에서 고정된 Z 슬라이드 중심까지'
                    : 'Y축 구성 중심에서 Z축 본체 중심까지'
                  : gantry.zMode === 'profile'
                    ? 'Y 슬라이드 중심에서 고정된 Z 슬라이드 중심까지'
                    : 'Y 슬라이드 중심에서 Z축 본체 중심까지',
              )}
              {gantry.zMode !== 'profile' && gantry.yMounting === 'wall'
                ? ` ${t('어댑터 플레이트(EHAM-MA)를 쓰면 Z축은 모터 쪽 끝이 핀 구멍에 맞춰 플레이트에 고정되고, Z 값은 쓰지 않습니다.')}`
                : ''}
            </p>
          </>
        )}
        {gantry.config === 'xyz' || gantry.config === 'xy' ? (
          <>
            <h3 className="subhead">
              {t('Y축 장착 위치')} <span className="heading-unit">(mm)</span>
            </h3>
            <VecFields value={gantry.offsets.xy} onChange={(v) => set('offsets', { ...gantry.offsets, xy: v })} />
            <p className="field-hint">
              {t('X축 구성 중심에서 Y축 본체 중심까지')}
              {gantry.yMounting === 'wall' && gantry.xMounting === 'floor'
                ? ` ${t(
                    gantry.parallel.x.mode === 'twinMotor' || gantry.parallel.x.mode === 'twinShaft'
                      ? '앵글 키트(EHAM-AK)를 쓰면 Y축은 첫 번째 X축의 키트가 잡는 위치(조립 설명서)에 놓이고, Y 값은 쓰지 않습니다.'
                      : '앵글 키트(EHAM-AK)를 쓰면 Y축은 키트가 잡는 위치(조립 설명서)에 놓이고, Y 값은 놓이는 쪽(+/−)만 정합니다.',
                  )}`
                : ''}
            </p>
          </>
        ) : null}
        <p className="field-hint gantry-note">
          {t('하위 축의 이동부는 하중이 가장 불리한 끝 위치(Z 하강 끝, Y 모터 쪽 끝)에 있다고 봅니다.')}
        </p>
      </details>

      <DetailSettings settings={shared} onSettings={setShared} />
    </aside>
  )
}

function VecFields({ value, onChange }: { value: Vec; onChange: (v: Vec) => void }) {
  return (
    <div className="grid-3">
      <NumberField label="X" value={value.x} min={-1e6} onChange={(x) => onChange({ ...value, x })} />
      <NumberField label="Y" value={value.y} min={-1e6} onChange={(y) => onChange({ ...value, y })} />
      <NumberField label="Z" value={value.z} min={-1e6} onChange={(z) => onChange({ ...value, z })} />
    </div>
  )
}
