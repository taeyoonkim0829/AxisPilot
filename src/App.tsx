import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { defaultComboOptions, type ComboOptions } from './cad/combo'
import { defaultGantry, initialGantrySettings, type GantryInputs, type GantrySettings } from './calc/gantry'
import { defaultPress, defaultSettings, type Requirements, type Settings } from './calc/types'
import { LangProvider, storedLang, storeLang, useT, type Lang } from './i18n'
import { computeSelection, noPicks, type Picks } from './selection'
import { AxisSteps } from './ui/AxisSteps'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { GantryInputPanel } from './ui/GantryInputPanel'
import { Footer } from './ui/Footer'
import { GantryWorkspace, type GantryState } from './ui/GantryWorkspace'
import { InputPanel } from './ui/InputPanel'
import type { ProfileView } from './ui/ProfileChart'
import { Report } from './ui/Report'
import type { AppMode } from './ui/ModeSwitch'
import { RouteRail } from './ui/RouteRail'
import { useReportExport } from './ui/useReportExport'
import type { Shared, SingleShare } from './share'
import { isStaleBuild, STALE_BUILD_NOTICE } from './ui/staleBuild'

const initialRequirements: Requirements = {
  stroke: 500,
  velocity: 0.5,
  acceleration: 2,
  jerk: 0,
  payload: 10,
  cog: { x: 0, y: 0, z: 50 },
  mounting: 'floor',
  press: defaultPress,
}

interface Inputs {
  req: Requirements
  settings: Settings
  setReq: (req: Requirements) => void
  setSettings: (settings: Settings) => void
  lang: Lang
  setLang: (lang: Lang) => void
  mode: AppMode
  setMode: (mode: AppMode) => void
}

/** The screen from the address: #gantry = gantry, else the single axis. */
const modeFromHash = (): AppMode => (window.location.hash === '#gantry' ? 'gantry' : 'single')

function useMode(initial?: AppMode): [AppMode, (mode: AppMode) => void] {
  const [mode, setModeState] = useState<AppMode>(initial ?? modeFromHash)
  useEffect(() => {
    const onHash = () => setModeState(modeFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const setMode = (next: AppMode) => {
    window.location.hash = next === 'gantry' ? 'gantry' : ''
    setModeState(next)
    window.scrollTo(0, 0)
  }
  return [mode, setMode]
}

/** `shared`: the calculation a shared link opened (`share.ts`), its screen shown with its inputs and choices */
export default function App({ shared = null }: { shared?: Shared | null }) {
  const [lang, setLang] = useState<Lang>(storedLang)
  useEffect(() => storeLang(lang), [lang])
  const single = shared?.mode === 'single' ? shared : null
  const gantryShared = shared?.mode === 'gantry' ? shared : null
  const [req, setReq] = useState(single?.req ?? initialRequirements)
  const [settings, setSettings] = useState<Settings>(single?.settings ?? defaultSettings)
  const [mode, setMode] = useMode(shared?.mode)
  // Both screens keep their inputs while the other one is shown.
  const [gantry, setGantry] = useState<GantryInputs>(gantryShared?.gantry ?? defaultGantry)
  const [gantrySettings, setGantrySettings] = useState<GantrySettings>(gantryShared?.gantrySettings ?? initialGantrySettings)
  const inputs: Inputs = { req, settings, setReq, setSettings, lang, setLang, mode, setMode }
  const gantryState: GantryState = { gantry, setGantry, gantrySettings, setGantrySettings, lang, setLang, mode, setMode }

  // A failing calculation or chart must not blank the page: the inputs stay, and editing one retries.
  return (
    <LangProvider value={lang}>
      {mode === 'single' ? (
        <ErrorBoundary key="single" resetKeys={[req, settings, lang]} fallback={(error, retry) => <Fallback {...inputs} error={error} retry={retry} />}>
          <Workspace {...inputs} shared={single} />
        </ErrorBoundary>
      ) : (
        <ErrorBoundary
          key="gantry"
          resetKeys={[gantry, gantrySettings, lang]}
          fallback={(error, retry) => <GantryFallback {...gantryState} error={error} retry={retry} />}
        >
          <GantryWorkspace {...gantryState} shared={gantryShared} />
        </ErrorBoundary>
      )}
    </LangProvider>
  )
}

/** The page after an error: the inputs and an error notice in place of the results. */
function Fallback({ req, settings, setReq, setSettings, lang, setLang, mode, setMode, error, retry }: Inputs & { error: Error; retry: () => void }) {
  return (
    <div className="app">
      <RouteRail axis={null} drive={null} kit={null} onExport={() => {}} exporting={false} lang={lang} onLang={setLang} />
      <main className="layout">
        <InputPanel req={req} settings={settings} onReq={setReq} onSettings={setSettings} mode={mode} onMode={setMode} />
        <div className="results">
          <ErrorPanel error={error} retry={retry} />
          <Footer />
        </div>
      </main>
    </div>
  )
}

function GantryFallback({ gantry, setGantry, gantrySettings, setGantrySettings, lang, setLang, mode, setMode, error, retry }: GantryState & { error: Error; retry: () => void }) {
  return (
    <div className="app">
      <RouteRail axis={null} drive={null} kit={null} onExport={() => {}} exporting={false} lang={lang} onLang={setLang} />
      <main className="layout">
        <GantryInputPanel gantry={gantry} onGantry={setGantry} settings={gantrySettings} onSettings={setGantrySettings} mode={mode} onMode={setMode} />
        <div className="results">
          <ErrorPanel error={error} retry={retry} />
          <Footer />
        </div>
      </main>
    </div>
  )
}

/** An error notice in place of the results. */
function ErrorPanel({ error, retry }: { error: Error; retry: () => void }) {
  const t = useT()
  if (isStaleBuild(error))
    return (
      <section className="panel error-panel" role="alert">
        <h2>{t(STALE_BUILD_NOTICE)}</h2>
        <button type="button" className="error-retry" onClick={() => window.location.reload()}>
          {t('새로 고침')}
        </button>
      </section>
    )
  return (
    <section className="panel error-panel" role="alert">
      <h2>{t('계산 중 오류가 발생했습니다')}</h2>
      <p>{t('입력값을 바꾸면 다시 계산합니다. 같은 오류가 계속되면 페이지를 새로고침하세요.')}</p>
      <pre className="error-message">{error.message}</pre>
      <button type="button" className="error-retry" onClick={retry}>
        {t('다시 시도')}
      </button>
    </section>
  )
}

function Workspace({ req, settings, setReq, setSettings, lang, setLang, mode, setMode, shared }: Inputs & { shared: SingleShare | null }) {
  const [picks, setPicks] = useState<Picks>(shared?.picks ?? noPicks)
  // Motion profile view (왕복 / 전진 / 복귀); the PDF prints the same view
  const [profileView, setProfileView] = useState<ProfileView>(shared?.profileView ?? 'cycle')
  // step 5 assembly orientation (parallel kit side, motor connector), printed in the report
  const [assembly, setAssembly] = useState<ComboOptions>(shared?.assembly ?? defaultComboOptions)

  const deferredReq = useDeferredValue(req)
  const deferredSettings = useDeferredValue(settings)
  const sel = useMemo(() => computeSelection(deferredReq, deferredSettings, picks), [deferredReq, deferredSettings, picks])
  const { selectedAxis, selectedDrive, selectedKitEval } = sel

  // PDF export: the report is mounted off screen only while the PDF is being made.
  const { exporting, start: startExport, reportRef } = useReportExport(lang, selectedAxis?.order.model ?? null, () => ({
    mode: 'single',
    req,
    settings,
    picks,
    profileView,
    assembly,
  }))

  return (
    <>
      <div className="app">
        <RouteRail
          axis={selectedAxis}
          drive={selectedDrive}
          kit={selectedKitEval}
          onExport={startExport}
          exporting={exporting}
          lang={lang}
          onLang={setLang}
        />
        <main className="layout">
          <InputPanel
            req={req}
            settings={settings}
            onReq={setReq}
            onSettings={setSettings}
            mode={mode}
            onMode={setMode}
            axisFamily={selectedAxis?.axis.family}
          />
          <div className="results">
            <AxisSteps
              sel={sel}
              req={deferredReq}
              calcSettings={deferredSettings}
              settings={settings}
              onSettings={setSettings}
              picks={picks}
              onPicks={setPicks}
              profileView={profileView}
              onProfileView={setProfileView}
              assembly={assembly}
              onAssembly={setAssembly}
            />
            <Footer />
          </div>
        </main>
      </div>
      {exporting && selectedAxis && (
        <div className="report-stage" ref={reportRef} aria-hidden="true">
          <Report
            req={deferredReq}
            settings={deferredSettings}
            axis={selectedAxis}
            drive={selectedDrive}
            kitMatch={sel.kitMatch}
            kit={selectedKitEval}
            profileView={profileView}
            assembly={assembly}
          />
        </div>
      )}
    </>
  )
}
