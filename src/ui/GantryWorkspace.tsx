import { useDeferredValue, useMemo, useState } from 'react'
import { defaultComboOptions, type ComboOptions } from '../cad/combo'
import { gantryAxes, gantryChain, type GantryAxis, type GantryInputs, type GantrySettings } from '../calc/gantry'
import { useT, type Lang } from '../i18n'
import { jointList } from '../calc/gantryKits'
import { computeGantry, noPicks, type GantryAxisResult, type Picks } from '../selection'
import { AxisSteps } from './AxisSteps'
import { useSlideThumb } from './useSlideThumb'
import { fmt, mountingLabel, statusLabel } from './format'
import { Footer } from './Footer'
import { GantryDrawing } from './GantryDrawing'
import { GantryInputPanel } from './GantryInputPanel'
import type { ProfileView } from './ProfileChart'
import { GantryOverview, Report } from './Report'
import type { AppMode } from './ModeSwitch'
import { RouteRail } from './RouteRail'
import { useReportExport } from './useReportExport'
import type { GantryShare } from '../share'

export interface GantryState {
  gantry: GantryInputs
  setGantry: (g: GantryInputs) => void
  gantrySettings: GantrySettings
  setGantrySettings: (s: GantrySettings) => void
  lang: Lang
  setLang: (lang: Lang) => void
  mode: AppMode
  setMode: (mode: AppMode) => void
}

const perAxis = <T,>(value: T): Record<GantryAxis, T> => ({ x: value, y: value, z: value })
const axisName = (a: GantryAxis) => a.toUpperCase()

/** `shared`: the open tab and the choices of a shared link (`share.ts`) */
export function GantryWorkspace({
  gantry,
  setGantry,
  gantrySettings,
  setGantrySettings,
  lang,
  setLang,
  mode,
  setMode,
  shared = null,
}: GantryState & { shared?: GantryShare | null }) {
  const t = useT()
  const [tab, setTab] = useState<GantryAxis>(shared?.tab ?? 'z')
  const [picks, setPicks] = useState<Record<GantryAxis, Picks>>(shared?.picks ?? perAxis(noPicks))
  const [views, setViews] = useState<Record<GantryAxis, ProfileView>>(shared?.views ?? perAxis<ProfileView>('cycle'))
  const [assemblies, setAssemblies] = useState<Record<GantryAxis, ComboOptions>>(shared?.assemblies ?? perAxis(defaultComboOptions))

  const deferredGantry = useDeferredValue(gantry)
  const deferredSettings = useDeferredValue(gantrySettings)
  const results = useMemo(() => computeGantry(deferredGantry, deferredSettings, picks), [deferredGantry, deferredSettings, picks])
  const chain = gantryChain(gantry.config)
  const active = chain.includes(tab) ? tab : chain[0]
  const current = results.find((r) => r.axis === active) ?? results[0]
  const sel = current.sel

  // the report covers every axis (X, Y, Z order), each needing its axis, motor and kit first
  const order = gantryAxes(gantry.config)
  const reportAxes = order.flatMap((a) => {
    const i = results.findIndex((r) => r.axis === a)
    return i < 0 ? [] : [{ name: t('{axis}축', { axis: axisName(a) }), order: i + 1, result: results[i] }]
  })
  const unselected = reportAxes.flatMap(({ name, result: { sel: s } }) =>
    [!s?.selectedAxis && t('직교 축'), !s?.selectedDrive && t('모터'), !s?.selectedKitEval && t('연결키트')]
      .filter((m): m is string => !!m)
      .map((m) => `${name} ${m}`),
  )
  const base = reportAxes[0]?.result.sel?.selectedAxis
  const { exporting, start: startExport, reportRef } = useReportExport(
    lang,
    base ? `${gantry.config.toUpperCase()}_${base.order.model}` : null,
    () => ({ mode: 'gantry', gantry, gantrySettings, picks, views, assemblies, tab: active }),
  )

  return (
    <>
      <div className="app gantry">
        <RouteRail
          axis={sel?.selectedAxis ?? null}
          drive={sel?.selectedDrive ?? null}
          kit={sel?.selectedKitEval ?? null}
          onExport={startExport}
          exporting={exporting}
          lang={lang}
          onLang={setLang}
          axes={<RailAxes results={results} order={order} active={active} onTab={setTab} />}
          missing={unselected}
        />
        <main className="layout">
          <GantryInputPanel
            gantry={gantry}
            onGantry={setGantry}
            settings={gantrySettings}
            onSettings={setGantrySettings}
            mode={mode}
            onMode={setMode}
            baseSpacing={results.find((r) => r.spacing)?.spacing}
          />
          <div className="results">
            <CarriedLoad result={current} gantry={deferredGantry} />
            {current.req && sel ? (
              <AxisSteps
                sel={sel}
                req={current.req}
                calcSettings={deferredSettings[active]}
                settings={gantrySettings[active]}
                onSettings={(s) => setGantrySettings({ ...gantrySettings, [active]: s })}
                picks={picks[active]}
                onPicks={(p) => setPicks({ ...picks, [active]: p })}
                profileView={views[active]}
                onProfileView={(v) => setViews({ ...views, [active]: v })}
                assembly={assemblies[active]}
                onAssembly={(o) => setAssemblies({ ...assemblies, [active]: o })}
                gantry
              />
            ) : (
              <section className="panel step" id="step-axis">
                <p className="empty">
                  {t('먼저 {axis}축을 선정하세요. 이 축이 실어 나르는 질량은 그 선정 결과로 정해집니다.', {
                    axis: axisName(chain[chain.indexOf(active) - 1]),
                  })}
                </p>
              </section>
            )}
            {/* below the open axis's steps (its step 5 drawing): the whole gantry assembled */}
            <GantryDrawing gantry={deferredGantry} results={results} assemblies={assemblies} />
            <Footer />
          </div>
        </main>
      </div>
      {exporting && unselected.length === 0 && (
        <div className="report-stage" ref={reportRef} aria-hidden="true">
          <GantryOverview gantry={deferredGantry} axes={reportAxes} />
          {reportAxes.map(({ name, result: r }) => (
            <Report
              key={r.axis}
              req={r.req!}
              settings={deferredSettings[r.axis]}
              axis={r.sel!.selectedAxis!}
              drive={r.sel!.selectedDrive}
              kitMatch={r.sel!.kitMatch}
              kit={r.sel!.selectedKitEval}
              profileView={views[r.axis]}
              assembly={assemblies[r.axis]}
              gantry={{ axis: name, rows: gantryReportRows(r, deferredGantry) }}
            />
          ))}
        </div>
      )}
    </>
  )
}

/**
 * The rail's axis row: the axes in display order (`order`: X, Y, Z), each with its place in the selection order
 * (tool end first), its verdict, model and load; the open one's frame slides to it.
 */
function RailAxes({
  results,
  order,
  active,
  onTab,
}: {
  results: GantryAxisResult[]
  order: GantryAxis[]
  active: GantryAxis
  onTab: (a: GantryAxis) => void
}) {
  const t = useT()
  const shown = order.filter((a) => results.some((r) => r.axis === a))
  const { ref, thumb } = useSlideThumb<HTMLDivElement>(shown.indexOf(active), shown.length)
  return (
    <div className="rail-axes" role="tablist" aria-label={t('조합축 축')} ref={ref}>
      {shown.map((a) => {
        const i = results.findIndex((r) => r.axis === a)
        const r = results[i]
        const s = r.sel
        const status = s?.selectedAxis ? worst(s) : null
        return (
          <button
            key={a}
            type="button"
            role="tab"
            aria-selected={a === active}
            className={`rail-axis${a === active ? ' active' : ''}`}
            onClick={() => onTab(a)}
          >
            <span className="rail-axis-no">{axisName(a)}</span>
            <span className="rail-axis-body">
              <span className="rail-axis-head">
                {status && <span className={`sign-status sign-status-${status}`}>{t(statusLabel[status])}</span>}
                <span>
                  {t('{n}번째 선정', { n: i + 1 })} · {r.req ? t('하중 {mass} kg', { mass: fmt(r.req.payload, 1) }) : t('하위 축 선정 필요')}
                </span>
              </span>
              <span className={`rail-axis-model${s?.selectedAxis ? '' : ' sign-empty'}`}>{s?.selectedAxis?.order.model ?? t('선택 안 됨')}</span>
            </span>
          </button>
        )
      })}
      {thumb && <span className="rail-axis-thumb" aria-hidden style={thumb} />}
    </div>
  )
}

/** Verdicts of the selected axis, drive and kit together (parts not picked yet do not count). */
function worst(s: NonNullable<GantryAxisResult['sel']>) {
  const list = [s.selectedAxis?.status, s.selectedDrive?.status, s.selectedKitEval?.status]
  return list.includes('fail') ? 'fail' : list.includes('warn') ? 'warn' : 'ok'
}

/** What the active axis carries and the accelerations across it, as passed to its checks. */
function CarriedLoad({ result, gantry }: { result: GantryAxisResult; gantry: GantryInputs }) {
  const t = useT()
  const req = result.req
  if (!req) return null
  const a = axisName(result.axis)
  return (
    <section className="panel gantry-load">
      <header className="step-head">
        <h2>{t('{axis}축 하중 조건', { axis: a })}</h2>
        <span className="muted">
          {t(mountingLabel[req.mounting])}
          {req.movingProfile ? ` · ${t('프로파일 이동')}` : ''}
        </span>
      </header>
      <dl className="gantry-load-list">
        <div>
          <dt>{t('하중')}</dt>
          <dd>
            <strong className="num">{fmt(req.payload, 2)} kg</strong>
            <span className="muted">
              {result.carried
                .map((c) => `${t(c.label, { axis: c.axis ?? '' })}${c.model ? ` ${c.model}` : ''} ${fmt(c.mass, 2)}`)
                .join(' + ')}
            </span>
          </dd>
        </div>
        <div>
          <dt>{t('무게 중심 (슬라이드 기준)')}</dt>
          <dd>
            <strong className="num">
              {fmt(req.cog.x, 0)} / {fmt(req.cog.y, 0)} / {fmt(req.cog.z, 0)} mm
            </strong>
            <span className="muted">
              {req.movingProfile ? t('이동 방향 X는 프로파일 끝단 기준') : t('X 이동 방향 · Y 측면 · Z 슬라이드 면 수직')}
            </span>
          </dd>
        </div>
        <div>
          <dt>{t('교차 가속도')}</dt>
          <dd>
            <strong className="num">
              {fmt(req.cross?.lateral ?? 0, 2)} / {fmt(req.cross?.normal ?? 0, 2)} m/s²
            </strong>
            <span className="muted">{t('측면 Y / 수직 Z · 다른 축의 가속을 동시에 가정')}</span>
          </dd>
        </div>
        {req.movingProfile && (
          <div>
            <dt>{t('함께 움직이는 구동부')}</dt>
            <dd>
              <strong className="num">{fmt(req.movingProfile.driveMass, 2)} kg</strong>
              <span className="muted">{t('모터 + 감속기 + 키트')}</span>
            </dd>
          </div>
        )}
      </dl>
      {result.drive && !result.drive.motorKnown && result.sel?.selectedDrive && (
        <p className="muted small-print">
          {t('모터 데이터에 질량이 없어 입력값 {mass} kg을 상위 축 하중에 사용합니다.', { mass: fmt(gantry.motorMass[result.axis], 2) })}
        </p>
      )}
    </section>
  )
}

/** The 하중 조건 for the report (labels are Korean source text). */
function gantryReportRows(r: GantryAxisResult, g: GantryInputs): [string, string][] {
  const req = r.req!
  return [
    ['조합축 구성', g.config.toUpperCase()],
    ['하중', `${fmt(req.payload, 2)} kg`],
    ['무게 중심 X / Y / Z', `${fmt(req.cog.x)} / ${fmt(req.cog.y)} / ${fmt(req.cog.z)} mm`],
    ['교차 가속도 (측면 / 수직)', `${fmt(req.cross?.lateral ?? 0)} / ${fmt(req.cross?.normal ?? 0)} m/s²`],
    ...(req.movingProfile ? ([['함께 움직이는 구동부', `${fmt(req.movingProfile.driveMass, 2)} kg`]] as [string, string][]) : []),
    ...(r.spacing ? ([[r.axis === 'x' ? 'X축 간격 (조합 키트에 맞춰 조정)' : 'Y축 간격 (조합 키트에 맞춰 조정)', `${fmt(r.spacing.used, 1)} mm ← ${fmt(r.spacing.entered, 1)} mm`]] as [string, string][]) : []),
    // the kit carrying the axis above on this axis's slide
    ...(r.joint
      ? ([['조합 키트', r.joint.kit ? jointList(r.joint, true) : '—']] as [string, string][])
      : []),
  ]
}
