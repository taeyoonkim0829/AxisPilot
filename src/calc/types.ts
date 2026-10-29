import type { AxisFamily, DriveKind, MotorMaker } from '../data/types'

export type Mounting = 'floor' | 'wall' | 'vertical'

export type AdditionalSlideSide = 'none' | 'left' | 'right' | 'both'

/** User-entered transport conditions (UI units). */
export interface Requirements {
  /** mm */
  stroke: number
  /** m/s */
  velocity: number
  /** m/s² */
  acceleration: number
  /** m/s³; 0 = unlimited (trapezoidal profile) */
  jerk: number
  /** kg */
  payload: number
  /** Payload centre of gravity relative to the slide centre, mm.
   *  x = travel direction, y = lateral on the slide surface, z = normal to the slide surface. */
  cog: { x: number; y: number; z: number }
  mounting: Mounting
  /** Pressing at the end of the forward move; absent or disabled = plain point-to-point move */
  press?: PressConditions
  /** Second axis or LM guides parallel to the axis; absent = single axis */
  parallel?: ParallelConfig
  /** Gantry: accelerations across the travel from the other axes; absent = none */
  cross?: CrossAcceleration
  /** Gantry Z axis with a moving profile: the slide is clamped, the profile moves with its drive and the payload.
   *  The COG is then measured from the centre of the profile's free end (the end away from the drive). */
  movingProfile?: { /** kg, motor, gearbox and kit on the profile */ driveMass: number }
}

/**
 * Peak accelerations (m/s², magnitudes) of the payload and the moving parts in the slide's lateral (y) and normal (z)
 * directions, caused by the other axes of a gantry. Taken as acting together with the axis's own acceleration.
 */
export interface CrossAcceleration {
  lateral: number
  normal: number
}

/**
 * Axis arrangement. Parallel members (axes, LM guides) sit side by side along the slide's lateral (y) direction,
 * rigidly connected by the payload plate: single axis, two axes driven by two synchronised motors (gantry) or by
 * one motor through a connecting shaft, or the axis with one or two LM guides.
 */
export type ParallelMode = 'single' | 'twinMotor' | 'twinShaft' | 'guides'

export interface ParallelConfig {
  mode: ParallelMode
  /** mm between neighbouring centrelines (axis–axis, axis–guide); the payload y is measured from the centre of the arrangement, the second axis or guide on the +y side */
  spacing: number
  /** guides: LM guides added (1–`MAX_GUIDES`), axis and guides `spacing` apart in a row (`guidePositions`) */
  guideCount: number
  /** guides, two or more: the axis at the edge (−y, the default) instead of in the middle */
  guideAxisEdge?: boolean
  /** kg, moving mass per LM guide (carriages and bracket) */
  guideMass: number
  /** twinShaft: kg·cm², connecting shaft and its couplings, at the axis drive shaft */
  shaftInertia: number
}

/** Most LM guides beside one axis */
export const MAX_GUIDES = 6

/**
 * Axis and LM guides in a row, `spacing` apart and centred on 0: member positions in units of the spacing and the
 * axis's index. The axis sits at the −y edge, or in the middle (left of centre when the count of members is even;
 * with one guide both are the same).
 */
export function guidePositions(p: Pick<ParallelConfig, 'guideCount' | 'guideAxisEdge'>) {
  const guides = Math.min(MAX_GUIDES, Math.max(1, Math.round(p.guideCount)))
  const positions = Array.from({ length: guides + 1 }, (_, i) => i - guides / 2)
  return { guides, positions, axis: p.guideAxisEdge ? 0 : Math.floor(guides / 2) }
}

export const defaultParallel: ParallelConfig = {
  mode: 'single',
  spacing: 300,
  guideCount: 1,
  guideAxisEdge: true,
  guideMass: 0,
  shaftInertia: 0,
}

/** Press cycle: approach at the set velocity, press over the last `distance` at `speed`, hold, return. */
export interface PressConditions {
  enabled: boolean
  /** N, pressing force over the press distance and the hold */
  force: number
  /** mm, travel at press speed at the end of the stroke */
  distance: number
  /** m/s */
  speed: number
  /** s, force held at standstill */
  holdTime: number
  /** Vertical axis only: pressing upward (bottom-up) or downward (top-down); the forward move goes this way */
  direction: VerticalDirection
}

export type VerticalDirection = 'up' | 'down'

export const defaultPress: PressConditions = {
  enabled: false,
  force: 1000,
  distance: 10,
  speed: 0.01,
  holdTime: 1,
  direction: 'down',
}

/** Direction of the forward move on a vertical axis: up, or down when pressing top-down; null when not vertical. */
export function verticalForward(req: Requirements): VerticalDirection | null {
  if (req.mounting !== 'vertical') return null
  return req.press?.enabled && req.press.direction === 'down' ? 'down' : 'up'
}

/** Advanced parameters; defaults follow the Excel calc sheets. */
export interface Settings {
  /** s, once per cycle, after the return move */
  dwellTime: number
  efficiency: Record<DriveKind, number>
  friction: Record<DriveKind, number>
  /** N, process force opposing the motion (Excel Fc) */
  externalForce: number
  /** N, guide seal resistance (Excel FG) */
  guideResistance: number
  /** kg·cm², coupling inertia at the motor side */
  couplingInertia: number
  /** h/day, for converting life in km to years */
  hoursPerDay: number
  /** mm between supports for the deflection check; 0 = supported only at both ends */
  supportSpan: number
  /** used when a motor has no allowable inertia ratio in the data */
  defaultInertiaRatio: number
  families: AxisFamily[]
  drives: DriveKind[]
  makers: MotorMaker[]
  /** power supplies the motors may run on (`motorSupply`); motors without supply data are always listed */
  supplies: Supply[]
  /** motor families (`Motor.family`) turned off; families not listed are included */
  excludedMotorFamilies: string[]
  requireBrake: boolean
  /** Electric cylinders (ESBF) run with an external guide that carries the payload: the rod lateral force is not checked */
  externalGuide: boolean
  /** false = motors are checked in direct drive only; true = with a compatible gearbox only */
  useGearbox: boolean
  /** Constant-velocity torque above the rated torque fails instead of warning */
  conservative: boolean
  /** Additional slide on axes that offer one (`Axis.additionalSlide`); 'both' only where both sides can be ordered */
  additionalSlide: AdditionalSlideSide
  /** mm, distance between the main and the additional slide (KL of both); below the axis minimum (`AdditionalSlide.gap`) the minimum */
  slideGap: number
  /** mm, likewise for KR when both additional slides are ordered */
  slideGapRight: number
  /** Toothed belt material by family (`BeltMaterial.code`; null = EGC chloroprene rubber) */
  beltMaterial: Partial<Record<AxisFamily, string | null>>
  /** m, motor cable length for the cable selection (Festo drives) */
  cableLength: number
  /** Order the axis at the next standard stroke (standard part number) instead of the modular product system's */
  standardStroke: boolean
}

export const defaultSettings: Settings = {
  dwellTime: 0,
  efficiency: { spindle: 0.9, belt: 0.8 },
  friction: { spindle: 0.05, belt: 0.1 },
  externalForce: 0,
  guideResistance: 0,
  couplingInertia: 0,
  hoursPerDay: 24,
  supportSpan: 0,
  defaultInertiaRatio: 10,
  families: ['ELGT'],
  drives: ['spindle'],
  makers: ['Festo'],
  supplies: ['ac400'],
  // EMMT-AS only
  excludedMotorFamilies: ['EMMT-ST', 'EMMT-EC', 'EMMB-AS', 'EMMB-ST', 'EMMS-ST', 'EMMH-AS'],
  requireBrake: false,
  externalGuide: false,
  useGearbox: false,
  conservative: false,
  cableLength: 5,
  additionalSlide: 'none',
  slideGap: 0,
  slideGapRight: 0,
  beltMaterial: { ELGD: 'PU2', EGC: null },
  standardStroke: false,
}

/** Motor power supply: 200–240 V AC, 380–480 V AC, DC (24/48 V) */
export type Supply = 'ac230' | 'ac400' | 'dc48'

export type Status = 'ok' | 'warn' | 'fail'

export interface Check {
  label: string
  value: number
  limit: number | null
  unit: string
  /** value / limit; null when there is no limit */
  ratio: number | null
  status: Status
  /** Korean source text; may contain `{name}` placeholders filled from `noteArgs` (translated in the UI) */
  note?: string
  noteArgs?: Record<string, string | number>
}

export function check(label: string, value: number, limit: number | null | undefined, unit: string, note?: string): Check {
  if (limit == null || !(limit > 0)) {
    return { label, value, limit: null, unit, ratio: null, status: 'ok', note: note ?? '데이터 없음 — 검토 생략' }
  }
  const ratio = Math.abs(value) / limit
  return { label, value, limit, unit, ratio, status: ratio <= 1 ? 'ok' : 'fail', note }
}

export function worstStatus(checks: Pick<Check, 'status'>[]): Status {
  if (checks.some((c) => c.status === 'fail')) return 'fail'
  if (checks.some((c) => c.status === 'warn')) return 'warn'
  return 'ok'
}
