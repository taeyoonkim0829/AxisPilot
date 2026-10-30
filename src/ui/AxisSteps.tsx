import type { ReactNode } from 'react'
import type { ComboOptions } from '../cad/combo'
import { verticalForward, type Requirements, type Settings } from '../calc/types'
import { useT } from '../i18n'
import type { Picks, Selection } from '../selection'
import { AxisStep } from './AxisStep'
import { DrawingStep } from './DrawingStep'
import { GearboxStep } from './GearboxStep'
import { KitStep } from './KitStep'
import { MotionProfile } from './MotionProfile'
import { MotorStep } from './MotorStep'
import type { ProfileView } from './ProfileChart'

interface Props {
  sel: Selection
  /** the requirements and settings the selection was computed from (deferred while typing) */
  req: Requirements
  calcSettings: Settings
  /** live settings, for the step header filters */
  settings: Settings
  onSettings: (settings: Settings) => void
  picks: Picks
  onPicks: (picks: Picks) => void
  profileView: ProfileView
  onProfileView: (view: ProfileView) => void
  assembly: ComboOptions
  onAssembly: (assembly: ComboOptions) => void
  /** gantry screen: the twin X axes stay side by side (no facing arrangement choice) */
  gantry?: boolean
  /** gantry screen: step 5 with its axis / gantry tabs, in place of this axis's drawing step */
  drawing?: ReactNode
}

/** Motion profile and steps 1–5 of one axis: axis, motor, gearbox, kit, combination drawing. */
export function AxisSteps({ sel, req, calcSettings, settings, onSettings, picks, onPicks, profileView, onProfileView, assembly, onAssembly, gantry = false, drawing }: Props) {
  const t = useT()
  const { selectedAxis, selectedDrive } = sel
  return (
    <>
      {selectedAxis && (
        <MotionProfile
          axis={selectedAxis}
          drive={selectedDrive}
          settings={calcSettings}
          vertical={verticalForward(req)}
          view={profileView}
          onView={onProfileView}
        />
      )}
      <AxisStep
        results={sel.axisResults}
        selectedId={selectedAxis?.axis.id ?? null}
        // Changing the axis or motor goes back to the recommendation for the steps after it.
        onSelect={(id) => onPicks({ ...picks, axisId: id, motorId: null, gearboxId: null })}
        settings={settings}
        onSettings={onSettings}
      />
      {selectedAxis ? (
        <MotorStep
          results={sel.motorResults}
          selected={selectedDrive}
          onSelect={(id) => onPicks({ ...picks, motorId: id, gearboxId: null })}
          settings={settings}
          onSettings={onSettings}
          layout={selectedAxis.layout}
        />
      ) : (
        <section className="panel step" id="step-motor">
          <p className="empty">{t('먼저 직교 축을 선택하세요.')}</p>
        </section>
      )}
      <GearboxStep
        options={sel.gearboxOptions}
        selected={selectedDrive}
        onSelect={(id) => onPicks({ ...picks, gearboxId: id })}
        useGearbox={calcSettings.useGearbox}
      />
      <KitStep
        match={sel.kitMatch}
        rows={sel.kitEvals}
        selectedId={sel.selectedKitEval?.kit.id ?? null}
        onSelect={(id) => onPicks({ ...picks, kitId: id })}
      />
      {drawing ?? (
        <DrawingStep
          axis={selectedAxis}
          drive={selectedDrive}
          kit={sel.selectedKitEval?.kit ?? null}
          req={req}
          sides={assembly}
          onSides={onAssembly}
          facingChoice={!gantry}
        />
      )}
    </>
  )
}
