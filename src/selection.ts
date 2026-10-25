// One axis's selection chain (axis → motor → gearbox → kit) from its requirements and the user's picks, shared by
// the single-axis screen and each axis of the gantry screen.
import { selectAxes, type AxisEvaluation } from './calc/axisSelection'
import { attachController } from './calc/controllerSelection'
import { attachKit, findKits, type KitEvaluation, type KitMatch } from './calc/kitSelection'
import { evaluateDrive, gearboxOptionsFor, selectMotors, type DriveEvaluation } from './calc/motorSelection'
import { baseParallel, gantryBase, gantryChain, gantryRequirements, stageOf, withBaseSpacing, type GantryAxis, type GantryInputs, type Stage } from './calc/gantry'
import type { Requirements, Settings } from './calc/types'
import { gantryJoint, jointMass, kitList, type GantryJoint } from './calc/gantryKits'
import { adapters, axes, brakingResistors, cables, controllers, kits, motors, shafts } from './data'

/** The user's picks; null = the recommendation */
export interface Picks {
  axisId: string | null
  motorId: string | null
  /** gearbox picked in step 3; null = the motor step's recommendation (direct drive unless useGearbox) */
  gearboxId: string | null
  kitId: string | null
}

export const noPicks: Picks = { axisId: null, motorId: null, gearboxId: null, kitId: null }

export interface Selection {
  axisResults: AxisEvaluation[]
  selectedAxis: AxisEvaluation | null
  motorResults: DriveEvaluation[]
  gearboxOptions: DriveEvaluation[]
  selectedDrive: DriveEvaluation | null
  kitMatch: KitMatch | null
  /** kits checked by attachKit, in list order */
  kitEvals: KitEvaluation[]
  selectedKitEval: KitEvaluation | null
}

/** Mounting kit, then Festo drive package: both verdicts fold into the drive option's status. */
function attachParts(axisEval: AxisEvaluation, drive: DriveEvaluation, settings: Settings) {
  return attachController(axisEval, attachKit(axisEval, drive, kits, settings), settings, { controllers, resistors: brakingResistors, cables })
}

export function computeSelection(req: Requirements, settings: Settings, picks: Picks): Selection {
  const axisResults = selectAxes(axes, req, settings, shafts)
  // Keep the user's pick while it is still listed; otherwise fall back to the best candidate.
  const selectedAxis =
    axisResults.find((r) => r.axis.id === picks.axisId) ?? axisResults.find((r) => r.status !== 'fail') ?? null
  const motorResults = selectedAxis ? selectMotors(selectedAxis, motors, settings, (d) => attachParts(selectedAxis, d, settings)) : []
  const motorResult = motorResults.find((r) => r.motor.id === picks.motorId) ?? null
  const selectedMotor = motorResult?.motor ?? null
  // Direct drive only, or each compatible gearbox when the motor step is set to use one; only a handful.
  const gearboxOptions =
    selectedAxis && selectedMotor
      ? (settings.useGearbox ? gearboxOptionsFor(selectedMotor) : [null]).map((g) =>
          attachParts(selectedAxis, evaluateDrive(selectedAxis, selectedMotor, g, settings), settings),
        )
      : []
  // The user's gearbox pick in step 3, else the one the motor step recommended.
  const selectedDrive =
    gearboxOptions.find((o) => o.gearbox && o.gearbox.id === picks.gearboxId) ??
    gearboxOptions.find((o) => (o.gearbox?.id ?? null) === (motorResult?.gearbox?.id ?? null)) ??
    gearboxOptions[0] ??
    null
  const kitMatch = selectedAxis && selectedDrive ? findKits(selectedAxis.axis, selectedDrive.motor, selectedDrive.gearbox, kits) : null
  const kitEvals = selectedDrive?.kits ?? []
  // The user's pick, else the drive's recommended kit
  const selectedKitEval = kitEvals.find((e) => e.kit.id === picks.kitId) ?? selectedDrive?.kit ?? null
  return { axisResults, selectedAxis, motorResults, gearboxOptions, selectedDrive, kitMatch, kitEvals, selectedKitEval }
}

/**
 * kg of the drive on the axis: motor (the fallback when its data has no mass), gearbox and kit. `motorKnown` is
 * false when the fallback was used.
 */
export function driveMassOf(selection: Selection, motorFallback: number): { mass: number; motorKnown: boolean } {
  const drive = selection.selectedDrive
  if (!drive) return { mass: motorFallback, motorKnown: false }
  const motor = drive.motor.mass
  const motorKnown = motor != null && motor > 0
  const mass = (motorKnown ? motor : motorFallback) + (drive.gearbox?.mass ?? 0) + (selection.selectedKitEval?.kit.mass ?? 0)
  return { mass, motorKnown }
}

/** One axis of the gantry: its derived requirements and selection, and what it hands to the axis carrying it. */
export interface GantryAxisResult {
  axis: GantryAxis
  /** null while an axis it carries has no selection */
  req: Requirements | null
  sel: Selection | null
  /** the selected axis with everything it carries; null without a selection */
  stage: Stage | null
  /** kg of the drive on this axis (motor fallback when its data has no mass) */
  drive: { mass: number; motorKnown: boolean } | null
  /** what this axis carries, kg each: payload, then each axis below it and its drive (labels with `{axis}`) */
  carried: { label: string; axis?: string; model?: string; mass: number }[]
  /** the gantry kit joining the axis below (the one this axis carries) to this axis's slide */
  joint: GantryJoint | null
  /** two base axes: the spacing set to fit the gantry kits (mm), when it differs from the entered one */
  spacing?: { entered: number; used: number }
}

/** mm, overall length of a selected gantry axis at its ordered stroke (as drawn); null without `baseLength` */
function carriedLength(r: GantryAxisResult): number | null {
  const e = r.sel?.selectedAxis
  return e && e.axis.baseLength != null ? (e.order.stroke ?? r.req!.stroke) + e.axis.baseLength : null
}

/**
 * The gantry's axes in selection order (tool first). Each axis carries the stage of the one before it; a moving
 * Z profile carries its own drive, so it is evaluated a second time with the mass of the drive selected the first
 * time.
 */
export function computeGantry(g: GantryInputs, settings: Record<GantryAxis, Settings>, picks: Record<GantryAxis, Picks>): GantryAxisResult[] {
  const out: GantryAxisResult[] = []
  const stages: Stage[] = []
  let carried: GantryAxisResult['carried'] = [{ label: '소재', mass: g.payload }]
  for (const a of gantryChain(g.config)) {
    const below = out.at(-1)
    if (below && !below.stage) {
      out.push({ axis: a, req: null, sel: null, stage: null, drive: null, carried: [], joint: null })
      continue
    }
    const evaluate = (g: GantryInputs) => {
      let req = gantryRequirements(g, a, below?.stage ?? null, stages)
      let sel = computeSelection(req, settings[a], picks[a])
      let drive = driveMassOf(sel, g.motorMass[a])
      if (req.movingProfile) {
        req = { ...req, movingProfile: { driveMass: drive.mass } }
        sel = computeSelection(req, settings[a], picks[a])
        drive = driveMassOf(sel, g.motorMass[a])
      }
      // The kit joining the axis below to this one depends on both; its mass moves with this axis: evaluated again
      const jointFor = (s: Selection) =>
        below?.sel?.selectedAxis && s.selectedAxis
          ? gantryJoint(g, a, below.axis, s.selectedAxis.axis, below.sel.selectedAxis.axis, below.req!.stroke, adapters, carriedLength(below))
          : null
      let joint = jointFor(sel)
      if (joint?.kit) {
        // a kit pinning the carried axis at its drive end on the −t side turns the carried stage
        if (below!.sel?.selectedAxis && below!.req && below!.drive) {
          below!.stage = stageOf(below!.axis, g, below!.sel.selectedAxis, below!.req, below!.drive.mass, joint.driveSign)
          stages[stages.length - 1] = below!.stage
        }
        req = gantryRequirements(g, a, below!.stage, stages, { mass: jointMass(joint), offset: joint.offset, at: joint.kitAt })
        if (req.movingProfile) req = { ...req, movingProfile: { driveMass: drive.mass } }
        sel = computeSelection(req, settings[a], picks[a])
        drive = driveMassOf(sel, g.motorMass[a])
        joint = jointFor(sel)
      }
      return { req, sel, drive, joint }
    }
    let { req, sel, drive, joint } = evaluate(g)
    // two base axes (X, or Y in yz) carrying the next on gantry kits: their spacing set to the one that fits the kits
    // (clear of each other, the second kit's screws on the carried axis's bores or its far end at the bracket);
    // twice, as the base axis (and so its kit) may change with it. A custom cross beam (`joint.beam`) has no `span`: the
    // entered spacing stays
    let spacing: GantryAxisResult['spacing']
    for (let pass = 0; pass < 2; pass++) {
      const fit = joint?.span?.spacing
      const entered = baseParallel(g).spacing
      const used = spacing?.used ?? entered
      if (a !== gantryBase(g.config) || fit == null || Math.abs(fit - used) < 0.05) break
      spacing = { entered, used: fit }
      ;({ req, sel, drive, joint } = evaluate(withBaseSpacing(g, fit)))
    }
    const kitLoad = joint?.kit
      ? [
          { label: '조합 키트', model: kitList(joint.kits), mass: joint.kits.reduce((m, k) => m + k.mass, 0) },
          // a custom cross beam at its length, with the Z plate on it
          ...(joint.beam
            ? [{ label: '크로스 빔 (주문 제작)', model: `${joint.beam.bracket.model} L ${Math.round(joint.beam.length)} mm`, mass: jointMass({ kits: [], beam: { ...joint.beam, plate: null } }) }]
            : []),
          ...(joint.beam?.plate ? [{ label: '조합 키트', model: kitList([joint.beam.plate]), mass: joint.beam.plate.mass }] : []),
        ]
      : []
    const stage = sel.selectedAxis ? stageOf(a, g, sel.selectedAxis, req, drive.mass) : null
    out.push({ axis: a, req, sel, stage, drive, carried: [...carried, ...kitLoad], joint, spacing })
    if (stage && sel.selectedAxis) {
      stages.push(stage)
      const name = a.toUpperCase()
      carried = [
        ...carried,
        ...kitLoad,
        { label: '{axis}축', axis: name, model: sel.selectedAxis.order.model, mass: sel.selectedAxis.axisMass },
        { label: '{axis}축 구동부', axis: name, mass: drive.mass },
      ]
    }
  }
  return out
}
