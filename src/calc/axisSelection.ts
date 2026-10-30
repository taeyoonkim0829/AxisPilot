// Axis sizing: motion profile, required force/torque at the axis drive shaft,
// guide load comparison value, deflection and life. Motor-independent.
import type { AdditionalSlide, Axis, BeltMaterial, ConnectingShaft } from '../data/types'
import { curveAt } from './curve'
import { dwellPhase, moveProfile, samplePhases, type MoveProfile, type Phase } from './motionProfile'
import { connectingShaftFor, noShaftCheck, shaftChecks, type ShaftFit } from './shaftSelection'
import { check, guidePositions, verticalForward, worstStatus, type Check, type ParallelMode, type Requirements, type Settings, type Status } from './types'

export const G = 9.81
/** N/mm², aluminium profile (Excel deflection sheet) */
const YOUNGS_MODULUS = 70000
/** Reference distance of the guide load comparison value [km] */
const GUIDE_REFERENCE_LIFE_KM = 5000
/** Ball screw life below this is shown in red [km] */
export const SCREW_LIFE_MIN_KM = 5000

export interface AxisSample {
  /** m/s, signed (+ = forward; vertical: see `verticalForward`) */
  v: number
  /** m/s² */
  a: number
  dir: 1 | -1 | 0
  dt: number
  move: number
  /** rad/s and rad/s² at the axis drive shaft */
  omega: number
  alpha: number
  /** Nm at the axis drive shaft, before drive efficiency */
  torque: number
  /** N the drive must apply to the slide */
  force: number
  /** N, process force from pressing (`Phase.load`) */
  load: number
}

/** Drive-shaft load for one kinematic state */
export type DriveState = Pick<AxisSample, 'omega' | 'alpha' | 'torque' | 'force'>

export interface InfoItem {
  label: string
  value: number
  unit: string
  /** Korean source text with `{name}` placeholders filled from `noteArgs` */
  note?: string
  noteArgs?: Record<string, string | number>
  /** shown in red (ball screw life under SCREW_LIFE_MIN_KM) */
  alert?: boolean
}

export interface AxisEvaluation {
  axis: Axis
  /** Model and order number for the required stroke */
  order: AxisOrder
  status: Status
  checks: Check[]
  info: InfoItem[]
  /** Forward move (vertical: up, or down when pressing top-down); with pressing the approach move (the press move when there is none) */
  profile: MoveProfile
  /** Return move */
  backProfile: MoveProfile
  /** Press move and hold at the end of the forward move; null without pressing */
  press: { profile: MoveProfile; distance: number; force: number; holdTime: number } | null
  /** The cycle: forward, one dwell, then the return; pressing: forward (approach, press, hold), return, dwell */
  cyclePhases: Phase[]
  /** One move with the dwell at its end, for the forward / return views */
  forwardPhases: Phase[]
  backPhases: Phase[]
  /** m/s, highest velocity of the cycle */
  peakVelocity: number
  /** Drive-shaft load at velocity v [m/s] and acceleration a [m/s²] while moving in direction dir, with process force load [N] */
  driveAt: (v: number, a: number, dir: 1 | -1 | 0, load?: number) => DriveState
  cycleTime: number
  /** payload + slide, kg */
  movingMass: number
  /** mm per revolution of the axis drive shaft */
  feed: number
  efficiency: number
  /** kg·cm² at the axis drive shaft (Festo J0 + JH·stroke + JL·payload); with a connecting shaft both axes and the shaft */
  inertia: number
  /** Drive-shaft samples of what the motor drives (both axes with a connecting shaft) */
  samples: AxisSample[]
  guideFv: number
  axisMass: number
  /** Axis arrangement (single axis, two axes, LM guides) */
  layout: ParallelLayout
  /** Additional slides and belt material; null for an axis without such options */
  options: AxisOptions | null
  /** Nm, no-load torque at the axis drive shaft (with the chosen belt) */
  noLoadTorque: number
  /** twinShaft: the Festo KSK connecting shaft fitted between the axes; null without one */
  shaft: ShaftFit | null
}

/** Order options of an axis from the settings */
export interface AxisOptions {
  /** type codes of the additional slides, in type code order (ZL; KL, KR) */
  slides: string[]
  /** mm the working stroke loses to them (slide length + gap each): the ordered stroke is that much longer */
  extension: number
  /** mm, per additional slide (as `slides`): its distance from the slide, from the entered centre spacing
   *  (`Settings.slidePitch`, KR of both: `slidePitchRight`), at least the axis minimum */
  gaps: number[]
  /** m, per additional slide: centre distance from the slide */
  pitches: number[]
  /** the chosen belt material; null when the axis has no choice */
  belt: BeltMaterial | null
}

/** Axes of the chosen families and drive that offer an additional slide: the choice is shown (and applies) when any do */
export const slideAxes = (all: Axis[], settings: Settings) =>
  all.filter((a) => a.additionalSlide && settings.families.includes(a.family) && settings.drives.includes(a.drive))

/**
 * Whether an axis can be ordered with the chosen additional slide: with one chosen, axes without it (ELGT-TB,
 * EGC-HD …) or, for both, without both leave the list. `choices` = `slideAxes`: while none of them offers the chosen
 * side (the choice hidden, or both on ELGT / ELGD only) it shows 없음 and nothing changes.
 */
export function offersSlides(axis: Axis, settings: Settings, choices: Axis[]): boolean {
  const side = settings.additionalSlide
  if (side === 'none' || !choices.some((a) => side !== 'both' || a.additionalSlide!.both)) return true
  return axis.additionalSlide != null && (side !== 'both' || axis.additionalSlide.both)
}

/** mm, half of both slide lengths: the centre spacing of the main and an additional slide with no gap between them */
const halfSlides = (axis: Axis) => ((axis.slideLength ?? axis.additionalSlide!.length) + axis.additionalSlide!.length) / 2

/** mm, the closest centre spacing of the main and an additional slide (the axis minimum distance between them); null
 *  without the option */
export const minSlidePitch = (axis: Axis): number | null => (axis.additionalSlide ? halfSlides(axis) + axis.additionalSlide.gap : null)

export function axisOptions(axis: Axis, settings: Settings): AxisOptions | null {
  const extra = axis.additionalSlide
  const materials = axis.beltMaterials
  if (!extra && !materials?.length) return null
  const side = settings.additionalSlide
  const slides =
    !extra || side === 'none' ? [] : side === 'both' ? (extra.both ? [extra.left, extra.right] : []) : [side === 'left' ? extra.left : extra.right]
  const chosen = settings.beltMaterial[axis.family]
  // centre spacing = half of both slide lengths + the distance between them
  const half = extra ? halfSlides(axis) : 0
  const gaps = extra ? slides.map((_, i) => Math.max((i === 1 ? settings.slidePitchRight : settings.slidePitch) - half, extra.gap)) : []
  return {
    slides,
    extension: extra ? gaps.reduce((sum, gap) => sum + extra.length + gap, 0) : 0,
    gaps,
    pitches: gaps.map((gap) => (half + gap) / 1000),
    belt: materials?.length ? (materials.find((m) => m.code === chosen) ?? materials[0]) : null,
  }
}

/** Type code with the options: additional slides, then the belt material (its last position) */
function optionCode(axis: Axis, template: string, options: AxisOptions | null): string {
  if (!options) return template
  const standard = axis.beltMaterials?.[0]?.code
  const base = standard && template.endsWith(`-${standard}`) ? template.slice(0, -standard.length - 1) : template
  const belt = options.belt ? options.belt.code : standard
  return [base, ...options.slides, ...(belt ? [belt] : [])].join('-')
}

/** Options that leave the standard product (no additional slide, the type code's belt) */
const customised = (axis: Axis, options: AxisOptions | null) =>
  !!options && (options.slides.length > 0 || (options.belt != null && options.belt !== axis.beltMaterials?.[0]))

/**
 * Loads on the most loaded of several slides on one guide carrying the payload as a rigid plate: slides at
 * `positions` along the travel (m, centred on the payload's x reference). Pitch and yaw moments become opposing
 * normal and lateral forces across the slides; the rolling moment is shared.
 */
export function slideGroupLoads(loads: GuideLoads, positions: number[]): GuideLoads {
  const n = positions.length
  if (n < 2) return loads
  const spread = positions.reduce((s, p) => s + p * p, 0)
  const far = Math.max(...positions.map(Math.abs))
  return { Fy: loads.Fy / n + (loads.Mz * far) / spread, Fz: loads.Fz / n + (loads.My * far) / spread, Mx: loads.Mx / n, My: 0, Mz: 0 }
}

/** What to order for an axis and a required stroke. */
export interface AxisOrder {
  /** Type code with the ordered stroke filled in, else the data model name */
  model: string
  partNumber: string | null
  /** mm, the ordered stroke; null when the axis is not ordered by stroke here */
  stroke: number | null
  /** true when no standard stroke fits and the stroke is configured (modular product system) */
  modular: boolean
}

/**
 * Axes of the modular product system are ordered at the required stroke: a whole mm within its variable range,
 * else the next of its fixed strokes (ELGT-BS has only fixed ones, 50 mm apart). That stroke takes its standard
 * part number when it is a standard stroke, else the module number. Axes without a module number (ELGT-TB-…-CS)
 * round up to the next standard stroke, and so does every axis with `standardOnly` (the modular stroke only when no
 * standard stroke is long enough). Axes without order data keep their data model name.
 */
export function axisOrder(axis: Axis, stroke: number, options: AxisOptions | null = null, standardOnly = false): AxisOrder {
  const template = axis.typeCode ?? axis.model
  if (!template.includes('…') || !(axis.strokePartNumbers || axis.moduleNumber)) {
    return { model: axis.model, partNumber: null, stroke: null, modular: false }
  }
  // Options are configured in the modular product system; additional slides lengthen the ordered stroke.
  const parts = customised(axis, options) ? {} : (axis.strokePartNumbers ?? {})
  const strokes = Object.keys(parts)
    .map(Number)
    .sort((a, b) => a - b)
  const floor = options?.slides.length ? (axis.additionalSlide?.minStroke ?? 0) : 0
  const configured = axis.moduleNumber ? moduleStroke(axis.moduleStrokes, Math.max(stroke + (options?.extension ?? 0), floor)) : null
  const next = strokes.find((s) => s >= stroke)
  const standard = configured == null || (standardOnly && next != null) ? next : strokes.find((s) => s === configured)
  const ordered = standard ?? configured ?? Math.ceil(stroke)
  return {
    model: optionCode(axis, template, options).replace('…', String(ordered)),
    partNumber: standard != null ? parts[String(standard)] : (axis.moduleNumber ?? null),
    stroke: ordered,
    modular: standard == null,
  }
}

/** Smallest stroke the modular product system takes for the required one (rounded up to a whole mm otherwise). */
function moduleStroke(strokes: Axis['moduleStrokes'], stroke: number) {
  const whole = Math.ceil(stroke)
  if (!strokes) return whole
  const [min, max] = strokes.variable ?? [Infinity, -Infinity]
  if (whole <= max) return Math.max(whole, min)
  return strokes.fixed.toSorted((a, b) => a - b).find((s) => s >= stroke) ?? whole
}

export function axisFeed(axis: Axis): number | null {
  if (axis.drive === 'spindle') return axis.spindlePitch
  return axis.feedConstant ?? (axis.pulleyDiameter ? Math.PI * axis.pulleyDiameter : null)
}

export function axisMass(axis: Axis, stroke: number): number {
  return axis.baseMass + (axis.massPer10mm * stroke) / 10
}

/** Ball screw load factor fw by speed (Excel "Ball Screw 수명계산"). */
export function screwLoadFactor(v: number): number {
  if (v <= 0.25) return 1.2
  if (v <= 1) return 1.5
  if (v <= 2) return 2
  return 3.5
}

/** Linear interpolation in a [x, y] curve, clamped to its ends. */
/**
 * Peak velocity vs the max speed. A ball screw's max speed falls above a stroke (critical speed of the screw):
 * the data sheet's speed-stroke curve is read at the built stroke.
 */
function speedCheck(axis: Axis, velocity: number, stroke: number): Check {
  if (!axis.speedCurve) return check('속도', velocity, axis.maxSpeed, 'm/s')
  const limit = Math.min(axis.maxSpeed, curveAt(axis.speedCurve, stroke))
  if (limit >= axis.maxSpeed) return check('속도', velocity, limit, 'm/s')
  return {
    ...check('속도', velocity, limit, 'm/s'),
    note: '스트로크 {stroke} mm의 속도-스트로크 선도 기준 (최대 {max} m/s)',
    noteArgs: { stroke: Math.round(stroke), max: axis.maxSpeed },
  }
}

/**
 * Peak feed force vs the max feed force. On ELGD-BS a force pushing the screw towards the motor is limited by
 * buckling above a stroke (data sheet curve, read at the built stroke). Which move pushes towards the motor
 * depends on where the motor sits, so the larger force of both directions is checked.
 */
function feedForceCheck(axis: Axis, force: number, stroke: number): Check {
  const buckling = axis.feedForceCurve ? curveAt(axis.feedForceCurve, stroke) : Infinity
  if (!(buckling < axis.maxFeedForce)) return check('이송력 Fx', force, axis.maxFeedForce, 'N')
  return {
    ...check('이송력 Fx', force, buckling, 'N'),
    note: '스트로크 {stroke} mm의 좌굴 한계 (모터 쪽으로 미는 힘, 최대 {max} N)',
    noteArgs: { stroke: Math.round(stroke), max: axis.maxFeedForce },
  }
}

export { curveAt }

export interface GuideLoads {
  Fy: number
  Fz: number
  Mx: number
  My: number
  Mz: number
}

/** Members of the axis arrangement, side by side along the slide's lateral (y) direction. */
export interface ParallelLayout {
  mode: ParallelMode
  /** m, lateral position of each member relative to the centre of the arrangement (the COG y reference) */
  positions: number[]
  /** true for an axis, false for an LM guide */
  isAxis: boolean[]
  axes: number
  /** motors driving the arrangement */
  motors: number
  guides: number
  /** Share of the payload carried in the travel direction by the more loaded axis (lever rule; 1 with one axis) */
  share: number
  /** kg, moving mass of the LM guides in total */
  guideMass: number
  /** kg·cm², connecting shaft at the axis drive shaft (one motor driving two axes), as entered; a fitted KSK replaces it */
  shaftInertia: number
}

const SINGLE: ParallelLayout = {
  mode: 'single',
  positions: [0],
  isAxis: [true],
  axes: 1,
  motors: 1,
  guides: 0,
  share: 1,
  guideMass: 0,
  shaftInertia: 0,
}

/**
 * The arrangement from the requirements, centred on y = 0 (the payload's y is measured from the centre). Two axes
 * or the axis and one LM guide sit at ∓spacing/2 (the first axis at −); an axis with more LM guides in a row
 * `spacing` apart, the axis in the middle or at the edge (−y) (`guidePositions`). With two axes the drive forces split by the lever rule about the payload's y position: half each
 * when centred, more on the axis on the payload side.
 */
export function parallelLayout(req: Requirements): ParallelLayout {
  const p = req.parallel
  const s = (p?.spacing ?? 0) / 1000
  if (!p || p.mode === 'single' || !(s > 0)) return SINGLE
  if (p.mode === 'guides') {
    const { guides, positions, axis } = guidePositions(p)
    return {
      ...SINGLE,
      mode: 'guides',
      positions: positions.map((k) => k * s),
      isAxis: positions.map((_, i) => i === axis),
      guides,
      guideMass: guides * Math.max(0, p.guideMass),
    }
  }
  const y = req.cog.y / 1000
  return {
    ...SINGLE,
    mode: p.mode,
    positions: [-s / 2, s / 2],
    isAxis: [true, true],
    axes: 2,
    motors: p.mode === 'twinMotor' ? 2 : 1,
    share: 0.5 + Math.abs(y) / s,
    shaftInertia: p.mode === 'twinShaft' ? Math.max(0, p.shaftInertia) : 0,
  }
}

/** Payload COG relative to the (first) axis slide centre, as the drawing places it (only that axis is drawn). */
export function axisCog(req: Requirements): Requirements['cog'] {
  const layout = parallelLayout(req)
  const axisY = layout.positions[layout.isAxis.indexOf(true)] * 1000
  return { ...req.cog, y: req.cog.y - axisY }
}

/**
 * Forces on the payload and moving parts by direction in the slide frame (N, magnitudes): travel (x), lateral (y)
 * and normal (z). Weight acts along the normal (floor), lateral (wall) or travel (vertical) direction; the axis's
 * own inertial force along the travel; a gantry's other axes add inertial forces across it (`req.cross`).
 */
function slideForces(req: Requirements, mass: number, accel: number) {
  const weight = mass * G
  const inertial = mass * accel
  const lateral = mass * (req.cross?.lateral ?? 0)
  const normal = mass * (req.cross?.normal ?? 0)
  switch (req.mounting) {
    case 'floor':
      return { travel: inertial, lateral, normal: weight + normal }
    case 'wall':
      return { travel: inertial, lateral: weight + lateral, normal }
    case 'vertical':
      return { travel: weight + inertial, lateral, normal }
  }
}

/**
 * Loads on each member of a parallel arrangement (rigid payload plate, members of equal stiffness). The rolling
 * moment about the travel axis turns into normal forces across the members (linear distribution), so the members
 * see no Mx; pitch and yaw moments and in-plane forces are shared equally. With two axes the drives take the yaw
 * from forces in the travel direction (inertial force, and the weight on a vertical axis); with one axis that yaw
 * acts about the axis and is shared by the guides. One member: `guideLoads`.
 */
export function memberLoads(req: Requirements, mass: number, accel: number, layout: ParallelLayout): GuideLoads[] {
  const n = layout.positions.length
  if (n === 1) return [guideLoads(req, mass, accel)]
  const x = Math.abs(req.cog.x) / 1000
  const y = req.cog.y / 1000
  const z = Math.abs(req.cog.z) / 1000
  const f = slideForces(req, mass, accel)
  const mean = layout.positions.reduce((a, b) => a + b, 0) / n
  const spread = layout.positions.reduce((sum, p) => sum + (p - mean) ** 2, 0)
  // Arm of the travel-direction forces about the single driving axis
  const yaw = layout.axes > 1 ? 0 : Math.abs(y - layout.positions[layout.isAxis.indexOf(true)])
  return layout.positions.map((p) => {
    const d = p - mean
    return {
      Fy: f.lateral / n,
      // normal forces spread by the payload's lateral position; lateral forces at height z roll onto the members
      Fz: Math.abs(f.normal * (1 / n + ((y - mean) * d) / spread)) + (z * f.lateral * Math.abs(d)) / spread,
      Mx: 0,
      My: (x * f.normal + z * f.travel) / n,
      Mz: (x * f.lateral + yaw * f.travel) / n,
    }
  })
}

/**
 * COG of the moving body of a moving-profile axis relative to the clamped slide, with the profile fully extended
 * (the free end farthest from the slide, the worst lever): payload beyond the free end (`req.cog` measured from
 * it), the profile's centre half a stroke out and the drive on the far end, half the base length behind the slide.
 */
export function movingProfileCog(req: Requirements, axis: Axis, profile: number, drive: number): Requirements['cog'] {
  const s = req.stroke
  const base = axis.baseLength ?? 0
  const total = req.payload + profile + drive
  if (!(total > 0)) return req.cog
  const x = (req.payload * (-(s + base / 2) + req.cog.x) - (profile * s) / 2 + (drive * base) / 2) / total
  return { x, y: (req.payload * req.cog.y) / total, z: (req.payload * req.cog.z) / total }
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Labels of the LM guide loads (reference values for choosing the guides) */
const LM_LOAD_LABELS: [keyof GuideLoads, string, string][] = [
  ['Fy', 'LM 가이드 하중 Fy', 'N'],
  ['Fz', 'LM 가이드 하중 Fz', 'N'],
  ['My', 'LM 가이드 모멘트 My', 'Nm'],
  ['Mz', 'LM 가이드 모멘트 Mz', 'Nm'],
]

/** Static + inertial guide loads from the payload centre of gravity (N, Nm). */
export function guideLoads(req: Requirements, mass: number, accel: number): GuideLoads {
  const x = Math.abs(req.cog.x) / 1000
  const y = Math.abs(req.cog.y) / 1000
  const z = Math.abs(req.cog.z) / 1000
  const f = slideForces(req, mass, accel)
  return {
    Fy: f.lateral,
    Fz: f.normal,
    Mx: z * f.lateral + y * f.normal,
    My: x * f.normal + z * f.travel,
    Mz: x * f.lateral + y * f.travel,
  }
}

export function guideComparisonValue(loads: GuideLoads, axis: Axis): { fv: number; missing: string[] } {
  const pairs: [keyof GuideLoads, number | null][] = [
    ['Fy', axis.FyMax],
    ['Fz', axis.FzMax],
    ['Mx', axis.MxMax],
    ['My', axis.MyMax],
    ['Mz', axis.MzMax],
  ]
  let fv = 0
  const missing: string[] = []
  for (const [key, max] of pairs) {
    if (loads[key] === 0) continue
    if (max && max > 0) fv += Math.abs(loads[key]) / max
    else missing.push(key)
  }
  return { fv, missing }
}

function lifeYears(km: number, strokeMm: number, cycleTime: number, hoursPerDay: number): number {
  const kmPerYear = ((2 * strokeMm) / 1e6) * (3600 / cycleTime) * hoursPerDay * 365
  return km / kmPerYear
}

function lifeNote(km: number, strokeMm: number, cycleTime: number, hoursPerDay: number) {
  return { note: '약 {years}년', noteArgs: { years: lifeYears(km, strokeMm, cycleTime, hoursPerDay).toFixed(1) } }
}

/** Press move of the forward stroke, or null when pressing is off or its inputs are not positive. */
function pressCycle(req: Requirements): AxisEvaluation['press'] {
  const p = req.press
  if (!p?.enabled || !(p.distance > 0 && p.speed > 0 && p.force >= 0)) return null
  const distance = Math.min(p.distance, req.stroke)
  return {
    profile: moveProfile(distance / 1000, p.speed, req.acceleration, req.jerk, 1),
    distance,
    force: p.force,
    holdTime: Math.max(0, p.holdTime),
  }
}

export function evaluateAxis(axis: Axis, req: Requirements, settings: Settings, shafts: ConnectingShaft[] = []): AxisEvaluation | null {
  const feed = axisFeed(axis)
  if (!feed || !(req.stroke > 0 && req.velocity > 0 && req.acceleration > 0)) return null
  // An electric cylinder has no profile to move.
  if (req.movingProfile && axis.rodLateralForceCurve) return null

  const strokeM = req.stroke / 1000
  const press = pressCycle(req)
  const approachM = strokeM - (press?.distance ?? 0) / 1000
  const approach = approachM > 1e-9 ? moveProfile(approachM, req.velocity, req.acceleration, req.jerk, 1) : null
  const fwd = approach ?? press!.profile
  const back = moveProfile(strokeM, req.velocity, req.acceleration, req.jerk, -1)
  const dwell = settings.dwellTime > 0 ? [dwellPhase(settings.dwellTime)] : []
  // Pressing: the press move and the hold (pushing at standstill, dir +1) carry the press force.
  const pressPhases: Phase[] = press
    ? [
        ...press.profile.phases.map((p) => ({ ...p, load: press.force })),
        ...(press.holdTime > 0 ? [{ ...dwellPhase(press.holdTime), dir: 1 as const, load: press.force }] : []),
      ]
    : []
  const forwardMoves = [...(approach?.phases ?? []), ...pressPhases]
  const forwardPhases = [...forwardMoves, ...dwell]
  const backPhases = [...back.phases, ...dwell]
  // One dwell per cycle, between the forward and the return move; pressing returns right after the hold and dwells
  // after the return
  const phases: Phase[] = press ? [...forwardMoves, ...back.phases, ...dwell] : [...forwardMoves, ...dwell, ...back.phases]
  const moves = press
    ? [...forwardMoves.map(() => 0), ...back.phases.map(() => 1), ...dwell.map(() => -1)]
    : [...forwardMoves.map(() => 0), ...dwell.map(() => -1), ...back.phases.map(() => 1)]
  const cycleTime = phases.reduce((t, p) => t + p.duration, 0)
  const peakVelocity = Math.max(fwd.peakVelocity, press?.profile.peakVelocity ?? 0)

  const vertical = req.mounting === 'vertical'
  const efficiency = settings.efficiency[axis.drive]
  const mu = settings.friction[axis.drive]
  // Mass and inertia follow the built stroke (the ordered one for ESBF), the motion the required one.
  const options = axisOptions(axis, settings)
  const order = axisOrder(axis, req.stroke, options, settings.standardStroke)
  const builtStroke = order.stroke ?? req.stroke
  // Additional slides move with the main one; the belt material changes the no-load torque.
  const extra: AdditionalSlide | null = options?.slides.length ? axis.additionalSlide! : null
  const slideCount = extra ? options!.slides.length : 0
  const extraMass = slideCount * (extra?.mass ?? 0)
  const noLoad = options?.belt?.noLoadTorque ?? axis.noLoadTorque
  // Parallel arrangement: with two axes each carries its share of the payload (the more loaded one is checked);
  // LM guides add their moving mass to the axis drive.
  const layout = parallelLayout(req)
  const share = layout.share
  const slide = axis.slideMass + extraMass + ((axis.slideMassPer10mm ?? 0) * builtStroke) / 10
  const mAxis = axisMass(axis, builtStroke) + extraMass
  // Moving profile (gantry Z): the slide is clamped, the profile and the drive on it move instead.
  const profile = req.movingProfile ? mAxis - axis.slideMass - extraMass : 0
  const driveMass = req.movingProfile ? Math.max(0, req.movingProfile.driveMass) : 0
  const moved = req.movingProfile ? profile + driveMass : slide
  const axisPayload = share * req.payload + layout.guideMass
  const mass = axisPayload + moved
  const axisInertia =
    axis.inertiaJ0 +
    (axis.inertiaJHPerMeter * builtStroke) / 1000 +
    slideCount * (extra?.inertia ?? axis.inertiaJLPerKg * (extra?.mass ?? 0))
  const inertia = axisInertia + axis.inertiaJLPerKg * (axisPayload + moved - slide)
  const toRad = (2 * Math.PI) / (feed / 1000)
  const down = verticalForward(req) === 'down'

  /** Drive-shaft load of a drive train moving m [kg] with inertia J [kg·cm²], taking share k of the external forces */
  const drive =
    (m: number, J: number, noLoad: number, k: number) =>
    (v: number, a: number, dir: 1 | -1 | 0, load = 0): DriveState => {
      // Weight opposes the forward move when it goes up and helps it when it goes down (top-down pressing).
      const gravity = vertical ? (down ? -1 : 1) * m * G : 0
      const resistance = mu * m * G + k * (settings.guideResistance + settings.externalForce)
      const sgn = v !== 0 ? Math.sign(v) : dir
      const external = gravity + sgn * resistance + k * load
      const torque = J * 1e-4 * a * toRad + (external * feed) / (2000 * Math.PI) + sgn * noLoad
      return { omega: v * toRad, alpha: a * toRad, torque, force: m * a + external }
    }
  const axisDriveAt = drive(mass, inertia, noLoad, share)
  // One motor driving both axes through a connecting shaft: the motor sees both axes, the payload and the shaft
  // (the KSK that fits the axis, else the entered inertia).
  const shaft = layout.mode === 'twinShaft'
  const ksk = shaft ? connectingShaftFor(axis, req.parallel?.spacing ?? 0, shafts) : null
  const shaftInertia = ksk?.inertia ?? layout.shaftInertia
  const trainInertia = shaft ? 2 * axisInertia + axis.inertiaJLPerKg * req.payload + shaftInertia : inertia
  const driveAt = shaft ? drive(req.payload + 2 * slide, trainInertia, 2 * noLoad, 1) : axisDriveAt
  const sampled = samplePhases(phases, (i) => moves[i])
  const samples: AxisSample[] = sampled.map((s) => ({ ...s, ...driveAt(s.v, s.a, s.dir, s.load) }))
  const axisSamples: AxisSample[] = shaft ? sampled.map((s) => ({ ...s, ...axisDriveAt(s.v, s.a, s.dir, s.load) })) : samples

  const shaftTorque = (list: AxisSample[]) =>
    Math.max(
      ...list
        .filter((s) => s.dir !== 0)
        .map((s) => (s.torque * s.omega >= 0 ? Math.abs(s.torque) / efficiency : Math.abs(s.torque) * efficiency)),
    )
  const moving = axisSamples.filter((s) => s.dir !== 0)
  const peakForce = Math.max(...moving.map((s) => Math.abs(s.force)))
  const peakShaftTorque = shaftTorque(axisSamples)

  const belt = options?.belt
  const checks: Check[] = [
    extra
      ? {
          ...check('스트로크', req.stroke + options!.extension, axis.maxStroke, 'mm'),
          note: '추가 슬라이드 {codes}: 슬라이드 길이 + 간격 {extension} mm 포함',
          noteArgs: { codes: options!.slides.join(' + '), extension: options!.extension },
        }
      : check('스트로크', req.stroke, axis.maxStroke, 'mm'),
    speedCheck(axis, peakVelocity, builtStroke),
    check('가속도', fwd.peakAcceleration, axis.maxAcceleration, 'm/s²'),
    feedForceCheck(axis, peakForce, builtStroke),
    belt && belt.noLoadTorque == null
      ? {
          ...check('구동 토크', peakShaftTorque, axis.maxDrivingTorque, 'Nm'),
          note: '{belt} 벨트의 무부하 토크 데이터 없음 — 기본 벨트 값 사용',
          noteArgs: { belt: belt.code ?? '' },
        }
      : check('구동 토크', peakShaftTorque, axis.maxDrivingTorque, 'Nm'),
  ]
  // The motor-side axis passes the second axis's torque on through its drive shaft.
  if (shaft) {
    const c = check('구동 토크 (연결축 포함)', shaftTorque(samples), axis.maxDrivingTorque, 'Nm')
    checks.push(
      c.status === 'fail'
        ? { ...c, status: 'warn', note: '모터 쪽 축의 구동축이 두 축의 토크를 전달합니다. 허용 여부를 Festo에 확인하세요' }
        : { ...c, note: '모터 쪽 축의 구동축이 두 축의 토크를 전달합니다' },
    )
    if (ksk) {
      // The shaft carries the second axis's drive torque (the more loaded share) and accelerates itself.
      const carried = Math.max(
        ...moving.map((s) => (s.torque * s.omega >= 0 ? Math.abs(s.torque) / efficiency : Math.abs(s.torque) * efficiency) + ksk.inertia * 1e-4 * Math.abs(s.alpha)),
      )
      const rpm = (Math.max(...moving.map((s) => Math.abs(s.omega))) * 60) / (2 * Math.PI)
      checks.push(...shaftChecks(ksk, carried, rpm))
    } else checks.push(noShaftCheck)
  }

  // Axes released for horizontal mounting only (ELGT-TB): vertical fails; side (wall) mounting is not covered.
  if (axis.mountingPosition === 'horizontal' && req.mounting !== 'floor') {
    checks.unshift({
      label: '설치 방향',
      value: Number.NaN, // shown as —
      limit: null,
      unit: '',
      ratio: null,
      status: req.mounting === 'vertical' ? 'fail' : 'warn',
      note: req.mounting === 'vertical' ? '수평 설치 전용 축입니다' : '수평 설치 전용 축입니다. 벽면(측면) 설치는 Festo에 확인하세요',
    })
  }

  // Electric cylinder: the pressure force is limited by buckling of the piston rod (rod length = stroke).
  // Positive force pushes in the forward direction, taken as the rod extending.
  if (axis.pressureForceCurve) {
    const compression = Math.max(0, ...axisSamples.map((s) => s.force))
    checks.push({
      ...check('압축력 (좌굴)', compression, curveAt(axis.pressureForceCurve, req.stroke), 'N'),
      note: '로드 길이 {stroke} mm 기준, 전진 = 로드가 나가는 방향',
      noteArgs: { stroke: req.stroke },
    })
  }

  if (settings.standardStroke && order.modular) {
    checks.push({
      label: '표준 스트로크',
      value: req.stroke,
      limit: null,
      unit: 'mm',
      ratio: null,
      status: 'warn',
      note: '맞는 표준 스트로크가 없어 모듈러 제품으로 주문합니다',
    })
  }

  // Without the data sheet curve only the stroke where the derating starts is known.
  if (!axis.speedCurve && axis.drive === 'spindle' && axis.speedLimitStroke && req.stroke > axis.speedLimitStroke) {
    checks.push({
      label: '스트로크별 속도 한계',
      value: req.stroke,
      limit: axis.speedLimitStroke,
      unit: 'mm',
      ratio: req.stroke / axis.speedLimitStroke,
      status: 'warn',
      note: '이 스트로크부터 볼스크류 최대 속도가 줄어듭니다. 카탈로그의 속도-스트로크 선도를 확인하세요.',
    })
  }

  // Guide loads: the whole moving system (payload, slides, LM guides) spread over the members; the more loaded
  // axis is checked.
  const systemMass = req.payload + layout.axes * moved + layout.guideMass
  const loadReq = req.movingProfile ? { ...req, cog: movingProfileCog(req, axis, profile, driveMass) } : req
  const members = memberLoads(loadReq, systemMass, fwd.peakAcceleration, layout)
  // Additional slides: the payload plate spans all slides of the axis, centred on the payload's x reference.
  // (ZL / KL on one side of the slide, ZR / KR on the other)
  const offsets = [0, ...(options?.slides ?? []).map((code, i) => (code === extra?.left ? -1 : 1) * options!.pitches[i])]
  const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length
  const slidePositions = slideCount ? offsets.map((x) => x - mean) : [0]
  const axisLoads = members.filter((_, i) => layout.isAxis[i]).map((l) => slideGroupLoads(l, slidePositions))
  const loads = axisLoads.reduce((a, b) => (guideComparisonValue(b, axis).fv > guideComparisonValue(a, axis).fv ? b : a))
  let fv = 0
  if (axis.rodLateralForceCurve) {
    // Electric cylinder: without an external guide the payload hangs on the piston rod.
    const lateral = Math.max(...axisLoads.map((l) => Math.hypot(l.Fy, l.Fz)))
    checks.push(
      settings.externalGuide
        ? check('로드 횡하중 Fq', lateral, null, 'N', '외부 가이드 사용 — 검토 생략')
        : { ...check('로드 횡하중 Fq', lateral, curveAt(axis.rodLateralForceCurve, req.stroke), 'N'), note: '무게 중심 오프셋에 의한 모멘트는 포함하지 않음' },
    )
  } else {
    const guide = guideComparisonValue(loads, axis)
    fv = guide.fv
    checks.push({
      ...check('가이드 하중 비교값 fv', fv, 1, ''),
      ...(guide.missing.length
        ? { note: '허용값 없음: {keys}', noteArgs: { keys: guide.missing.join(', ') } }
        : extra
          ? { note: '슬라이드 {n}개에 걸친 부하, 가장 큰 하중의 슬라이드 기준', noteArgs: { n: slideCount + 1 } }
          : {}),
    })
  }

  if (!vertical) {
    const totalLength = axis.baseLength ? req.stroke + (options?.extension ?? 0) + axis.baseLength : null
    const span = settings.supportSpan > 0 ? settings.supportSpan : totalLength
    const I = req.mounting === 'floor' ? axis.Iy : axis.Iz
    if (span && I) {
      const selfWeight = mAxis * G * (totalLength ? Math.min(1, span / totalLength) : 1)
      // Point load: the weight on this axis (its share in a parallel arrangement)
      const pointLoad = layout.positions.length > 1 ? (req.mounting === 'floor' ? loads.Fz : loads.Fy) : mass * G
      const deflection =
        (pointLoad * span ** 3) / (48 * YOUNGS_MODULUS * I) + (5 * selfWeight * span ** 3) / (384 * YOUNGS_MODULUS * I)
      const limit = axis.allowableDeflection ?? 0.5
      const c = { ...check('처짐', deflection, limit, 'mm', '지지 간격 {span} mm 기준'), noteArgs: { span: Math.round(span) } }
      checks.push(c.status === 'fail' ? { ...c, status: 'warn', note: '지지 간격 {span} mm 기준 — 중간 지지 추가 또는 지지 간격 입력 검토' } : c)
    }
  }

  const info: InfoItem[] = [
    { label: '사이클 타임 (왕복)', value: cycleTime, unit: 's' },
    {
      label: '이동 질량 (부하 + 슬라이드)',
      value: mass,
      unit: 'kg',
      ...(layout.axes > 1
        ? { note: '축 1개당, 부하 분담 {share}%', noteArgs: { share: Math.round(share * 100) } }
        : layout.guides > 0
          ? { note: 'LM 가이드 {mass} kg 포함', noteArgs: { mass: layout.guideMass } }
          : req.movingProfile
            ? { note: '프로파일 이동: 축 프로파일 {profile} kg + 구동부 {drive} kg', noteArgs: { profile: round1(profile), drive: round1(driveMass) } }
            : {}),
    },
    { label: '축 질량', value: mAxis, unit: 'kg' },
    ...(extra
      ? [
          {
            label: '추가 슬라이드',
            value: slideCount,
            unit: '',
            note:
              options!.pitches.some((p, i) => (i === 1 ? settings.slidePitchRight : settings.slidePitch) < Math.round(p * 1000))
                ? '{codes}, 1개 {mass} kg, 슬라이드 사이 거리 {gap} mm (최소 거리), 중심 간격 {pitch} mm'
                : '{codes}, 1개 {mass} kg, 슬라이드 사이 거리 {gap} mm, 중심 간격 {pitch} mm',
            noteArgs: {
              codes: options!.slides.join(' + '),
              mass: extra.mass,
              gap: options!.gaps.join(' / '),
              pitch: options!.pitches.map((p) => Math.round(p * 1000)).join(' / '),
            },
          },
        ]
      : []),
    { label: '축 관성 모멘트 (구동축 기준)', value: trainInertia, unit: 'kg·cm²', ...(shaft ? { note: '2축 + 연결축' } : {}) },
  ]
  if (ksk)
    info.push({
      label: '연결축 관성 모멘트',
      value: ksk.inertia,
      unit: 'kg·cm²',
      note: '{model}, 주문번호 {partNumber} (J0 + JL·LN)',
      noteArgs: { model: ksk.model, partNumber: ksk.shaft.partNumber },
    })
  if (shaft) info.push({ label: '모터 구동 이동 질량 (2축 합계)', value: req.payload + 2 * slide, unit: 'kg' })
  // LM guides: the largest load on one guide, for choosing the guide blocks
  const guideMembers = members.filter((_, i) => !layout.isAxis[i])
  if (guideMembers.length) {
    for (const [key, label, unit] of LM_LOAD_LABELS) {
      const value = Math.max(...guideMembers.map((l) => l[key]))
      if (value > 0) info.push({ label, value, unit, note: '1개당 최대 (정하중 + 가속)' })
    }
  }
  if (fv > 0) {
    const km = GUIDE_REFERENCE_LIFE_KM / fv ** 3
    info.push({ label: '가이드 예상 수명', value: km, unit: 'km', ...lifeNote(km, req.stroke, cycleTime, settings.hoursPerDay) })
  }
  if (axis.drive === 'spindle' && axis.screwDynamicLoadRating && axis.spindlePitch) {
    let num = 0
    let den = 0
    for (const s of moving) {
      const w = Math.abs(s.v) * s.dt
      num += Math.abs(s.force) ** 3 * w
      den += w
    }
    const meanLoad = Math.cbrt(num / den)
    const loadKm = (axis.screwDynamicLoadRating / (screwLoadFactor(peakVelocity) * meanLoad)) ** 3 * axis.spindlePitch
    // ESBF-BS: the life also ends after a number of switching cycles (one cycle = one round trip of the stroke).
    const cycleKm = axis.maxSwitchingCycles ? (axis.maxSwitchingCycles * 2 * req.stroke) / 1e6 : Infinity
    const km = Math.min(loadKm, cycleKm)
    const life = lifeNote(km, req.stroke, cycleTime, settings.hoursPerDay)
    info.push({
      label: '볼스크류 예상 수명',
      value: km,
      unit: 'km',
      ...(cycleKm < loadKm
        ? {
            note: '약 {years}년 · 왕복 {cycles}회 한계',
            noteArgs: { ...life.noteArgs, cycles: axis.maxSwitchingCycles!.toLocaleString('en-US') },
          }
        : life),
      alert: km < SCREW_LIFE_MIN_KM,
    })
    if (km < SCREW_LIFE_MIN_KM) {
      checks.push({
        label: '볼스크류 수명',
        value: km,
        limit: SCREW_LIFE_MIN_KM,
        unit: 'km',
        ratio: SCREW_LIFE_MIN_KM / km,
        status: 'warn',
        note: '예상 수명 {min} km 미만',
        noteArgs: { min: SCREW_LIFE_MIN_KM },
      })
    }
  }

  return {
    axis,
    order,
    status: worstStatus(checks),
    checks,
    info,
    profile: fwd,
    backProfile: back,
    press,
    cyclePhases: phases,
    forwardPhases,
    backPhases,
    peakVelocity,
    driveAt,
    cycleTime,
    movingMass: mass,
    feed,
    efficiency,
    inertia: trainInertia,
    samples,
    guideFv: fv,
    axisMass: mAxis,
    layout,
    options,
    noLoadTorque: noLoad,
    shaft: ksk,
  }
}

const statusOrder: Record<Status, number> = { ok: 0, warn: 1, fail: 2 }

export function selectAxes(all: Axis[], req: Requirements, settings: Settings, shafts: ConnectingShaft[] = []): AxisEvaluation[] {
  const choices = slideAxes(all, settings)
  return all
    .filter((a) => settings.families.includes(a.family) && settings.drives.includes(a.drive) && offersSlides(a, settings, choices))
    .map((a) => evaluateAxis(a, req, settings, shafts))
    .filter((e): e is AxisEvaluation => e !== null)
    .sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || a.axisMass - b.axisMass)
}
