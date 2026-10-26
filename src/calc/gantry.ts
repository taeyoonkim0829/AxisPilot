// Gantry (Cartesian handling system): the axes are selected one after another from the tool upwards. Each axis
// carries the payload and the axes above it in the chain; its requirements come from what it carries (mass and
// centre of gravity, in its own slide frame) and from the accelerations of the other axes across its travel.
import type { AxisEvaluation } from './axisSelection'
import { defaultParallel, defaultSettings, type CrossAcceleration, type Mounting, type ParallelConfig, type Requirements, type Settings } from './types'

export type GantryAxis = 'x' | 'y' | 'z'
/** xyz: X on the floor, Y on the X slide(s), Z on the Y slide; yz: Y carrying Z; xy: X carrying Y */
export type GantryConfig = 'xyz' | 'yz' | 'xy'
/** slide: the Z profile is fixed to the Y slide, the Z slide moves; profile: the Z slide is fixed, the profile moves */
export type ZMode = 'slide' | 'profile'

export interface AxisMotion {
  /** mm */
  stroke: number
  /** m/s */
  velocity: number
  /** m/s² */
  acceleration: number
  /** m/s³; 0 = unlimited */
  jerk: number
}

/** World vector in mm: X, Y horizontal (travel of the X and Y axes), Z up. */
export interface Vec {
  x: number
  y: number
  z: number
}

export interface GantryInputs {
  config: GantryConfig
  /** kg */
  payload: number
  /** Payload COG from the tool mounting point, world mm: the Z slide centre (profile: centre of the profile's free
   *  end), or the Y slide centre without Z */
  cog: Vec
  motion: Record<GantryAxis, AxisMotion>
  zMode: ZMode
  yMounting: Exclude<Mounting, 'vertical'>
  xMounting: Exclude<Mounting, 'vertical'>
  /** The base axis's arrangement (two axes or LM guides; the arrangement's centre is its reference): X in xyz / xy,
   *  Y in yz (`gantryBase`); each kept, so switching the configuration keeps both */
  parallel: Record<ParallelAxis, ParallelConfig>
  /** Mounting point of the carried axis from the carrier's slide centre (the base axis: from the centre of its
   *  arrangement),
   *  world mm: yz = Z on Y (profile centre, or the clamped Z slide), xy = Y profile centre on X */
  offsets: { yz: Vec; xy: Vec }
  /** kg, motor mass when the motor data has none */
  motorMass: Record<GantryAxis, number>
}

export const defaultGantry: GantryInputs = {
  config: 'xyz',
  payload: 5,
  cog: { x: 0, y: 0, z: 50 },
  motion: {
    x: { stroke: 1000, velocity: 1, acceleration: 2, jerk: 0 },
    y: { stroke: 500, velocity: 1, acceleration: 2, jerk: 0 },
    z: { stroke: 200, velocity: 0.5, acceleration: 2, jerk: 0 },
  },
  zMode: 'slide',
  yMounting: 'wall',
  xMounting: 'floor',
  parallel: { x: { ...defaultParallel, mode: 'twinMotor', spacing: 600 }, y: { ...defaultParallel, spacing: 600 } },
  offsets: { yz: { x: 0, y: 0, z: 0 }, xy: { x: 0, y: 0, z: 0 } },
  motorMass: { x: 3, y: 2, z: 1.5 },
}

/** Settings per axis: the step filters differ, the 상세 설정 values are shared. */
export type GantrySettings = Record<GantryAxis, Settings>

export const initialGantrySettings: GantrySettings = {
  // the long base axis: toothed belt
  x: { ...defaultSettings, drives: ['belt'] },
  y: defaultSettings,
  // a vertical axis must not drop the load on power loss
  z: { ...defaultSettings, requireBrake: true },
}

/** Axes of a configuration in selection order, from the tool to the base. */
export function gantryChain(config: GantryConfig): GantryAxis[] {
  return config === 'xyz' ? ['z', 'y', 'x'] : config === 'yz' ? ['z', 'y'] : ['y', 'x']
}

/** The axes that can be the base of a gantry, and so a parallel arrangement */
export type ParallelAxis = Exclude<GantryAxis, 'z'>

/** The base axis (bottom of the chain): X, or Y in yz */
export const gantryBase = (config: GantryConfig): ParallelAxis => gantryChain(config).at(-1) as ParallelAxis

/** The base axis's arrangement */
export const baseParallel = (g: GantryInputs): ParallelConfig => g.parallel[gantryBase(g.config)]

/** The inputs with the base axis's spacing changed */
export const withBaseSpacing = (g: GantryInputs, spacing: number): GantryInputs => {
  const b = gantryBase(g.config)
  return { ...g, parallel: { ...g.parallel, [b]: { ...g.parallel[b], spacing } } }
}

/** The axes in display order (X, Y, Z); the selection order stays `gantryChain` */
export const gantryAxes = (config: GantryConfig): GantryAxis[] => [...gantryChain(config)].sort()

export const axisMounting = (g: GantryInputs, a: GantryAxis): Mounting =>
  a === 'z' ? 'vertical' : a === 'y' ? g.yMounting : g.xMounting

type V3 = [number, number, number]
const unit: Record<GantryAxis, V3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }
// `+ 0` turns −0 into 0
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + 0
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1] + 0, a[2] * b[0] - a[0] * b[2] + 0, a[0] * b[1] - a[1] * b[0] + 0]
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
const add = (...vs: V3[]): V3 => vs.reduce<V3>((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0])
const toV3 = (v: Vec): V3 => [v.x, v.y, v.z]

/**
 * Slide frame of an axis in world directions: travel t, slide normal n, lateral l = n × t (the app's x, z, y).
 * Floor: slide facing up. Wall: X faces −Y, Y faces −X. Z (vertical) faces −X, so its lateral is world Y.
 */
export function slideFrame(a: GantryAxis, mounting: Mounting): { t: V3; l: V3; n: V3 } {
  const t = unit[a]
  const n: V3 = mounting === 'floor' ? [0, 0, 1] : a === 'x' ? [0, -1, 0] : [-1, 0, 0]
  return { t, l: cross(n, t), n }
}

/**
 * Z hangs on a cross beam spanning two floor-mounted Y axes (yz, Y in a twin arrangement): the beam runs along X,
 * so the Z slide faces across it, −Y (as a wall-mounted X would), instead of −X.
 */
export const zAcrossTwinY = (g: GantryInputs): boolean =>
  g.config === 'yz' && g.yMounting === 'floor' && (g.parallel.y.mode === 'twinMotor' || g.parallel.y.mode === 'twinShaft') && g.parallel.y.spacing > 0

/** The slide frame of a gantry axis: `slideFrame` for its mounting, Z across twin floor Y axes facing −Y */
export function axisFrame(g: GantryInputs, a: GantryAxis): { t: V3; l: V3; n: V3 } {
  if (a === 'z' && zAcrossTwinY(g)) {
    const n: V3 = [0, -1, 0]
    return { t: unit.z, l: cross(n, unit.z), n }
  }
  return slideFrame(a, axisMounting(g, a))
}

/** World vector → slide frame (x travel, y lateral, z normal). */
function toSlide(v: V3, f: ReturnType<typeof slideFrame>): Vec {
  return { x: dot(v, f.t), y: dot(v, f.l), z: dot(v, f.n) }
}

/** Slide frame → world vector. */
function toWorld(v: Vec, f: ReturnType<typeof slideFrame>): V3 {
  return add(scale(f.t, v.x), scale(f.l, v.y), scale(f.n, v.z))
}

/** A selected axis with everything it carries, as the axis carrying it sees it. */
export interface Stage {
  axis: GantryAxis
  /** kg, axis, drive and everything carried */
  mass: number
  /** COG from the axis's mounting point, world mm, at the worst position (moving part at the drive end, Z extended) */
  cog: V3
  /** kg, the part that moves with this axis's own travel */
  moving: number
  /** kg, motor + gearbox + kit */
  driveMass: number
}

/**
 * The mass points of a selected axis, from its mounting point (profile centre, or the clamped slide for a moving
 * profile). The moving part sits at the end of the stroke: Z extended downwards, Y at the drive end, the end that
 * puts the most load on one side of the axis below. The drive is at the +t end (on top of Z), or at −t with
 * `driveSign` −1 (a gantry kit pinning the axis at its drive end on that side).
 */
export function stageOf(a: GantryAxis, g: GantryInputs, evaluation: AxisEvaluation, req: Requirements, driveMass: number, driveSign: 1 | -1 = 1): Stage {
  const f = axisFrame(g, a)
  const axis = evaluation.axis
  const stroke = req.stroke
  const length = stroke + (axis.baseLength ?? 0)
  const base = axis.baseLength ?? 0
  const slide = axis.slideMass
  const profile = evaluation.axisMass - slide
  const payload = req.payload
  // Z moves its load down, the others towards the drive end.
  const out = a === 'z' ? -1 : 1
  const points: [number, V3][] = []
  if (a === 'z' && req.movingProfile) {
    points.push([slide, [0, 0, 0]])
    points.push([profile, scale(f.t, (out * stroke) / 2)])
    points.push([driveMass, scale(f.t, base / 2)])
    // payload COG measured from the profile's free end
    points.push([payload, add(scale(f.t, out * (stroke + base / 2)), toWorld(req.cog, f))])
  } else {
    const at = scale(f.t, ((a === 'z' ? out : driveSign) * stroke) / 2)
    points.push([profile, [0, 0, 0]])
    // drive on the far end: on top of Z, at the +Y end of Y (−Y with driveSign −1)
    points.push([driveMass, scale(f.t, (driveSign * length) / 2)])
    points.push([slide, at])
    points.push([payload, add(at, toWorld(req.cog, f))])
  }
  const mass = points.reduce((s, [m]) => s + m, 0)
  const cog = scale(add(...points.map(([m, p]) => scale(p, m))), mass > 0 ? 1 / mass : 0)
  const moving = req.movingProfile ? mass - slide : slide + payload
  return { axis: a, mass, cog, moving, driveMass }
}

/**
 * Requirements of one axis of the gantry. `carried` is the stage directly above it (null for the tool axis);
 * `stages` are all stages above it, for the reaction of their accelerations. Axes below it carry it, so their
 * accelerations act on its whole moving system. `kit`: the gantry kits on this axis's slides (kg, moving with it, at
 * `at`) and the carried axis's mounting point they give (`offset`, else the entered one); world mm as `offsets`.
 */
export function gantryRequirements(
  g: GantryInputs,
  a: GantryAxis,
  carried: Stage | null,
  stages: Stage[],
  kit: { mass: number; offset: Vec; at: Vec } | null = null,
): Requirements {
  const mounting = axisMounting(g, a)
  const f = axisFrame(g, a)
  const m = g.motion[a]
  const chain = gantryChain(g.config)
  const below = chain.slice(chain.indexOf(a) + 1)
  let payload: number
  let cog: Vec
  if (carried) {
    const offset = toV3(kit?.offset ?? (carried.axis === 'z' ? g.offsets.yz : g.offsets.xy))
    const kitMass = kit?.mass ?? 0
    payload = carried.mass + kitMass
    cog = toSlide(add(scale(add(carried.cog, offset), carried.mass / payload), scale(kit ? toV3(kit.at) : offset, kitMass / payload)), f)
  } else {
    payload = g.payload
    // the 부하 무게 중심 input counts X and Z the other way (+X = world −X, away from the Z slide face; +Z = down)
    cog = toSlide([-g.cog.x, g.cog.y, -g.cog.z], f)
  }
  // Accelerations across the travel: axes below move all of it; axes above react with their moving part only.
  const parts: [V3, number][] = [
    ...below.map((b): [V3, number] => [unit[b], g.motion[b].acceleration]),
    ...stages.map((s): [V3, number] => [unit[s.axis], payload > 0 ? (g.motion[s.axis].acceleration * s.moving) / payload : 0]),
  ]
  const crossAccel: CrossAcceleration = {
    lateral: parts.reduce((sum, [d, acc]) => sum + Math.abs(dot(d, f.l)) * acc, 0),
    normal: parts.reduce((sum, [d, acc]) => sum + Math.abs(dot(d, f.n)) * acc, 0),
  }
  return {
    stroke: m.stroke,
    velocity: m.velocity,
    acceleration: m.acceleration,
    jerk: m.jerk,
    payload,
    cog,
    mounting,
    parallel: a === gantryBase(g.config) ? baseParallel(g) : undefined,
    cross: crossAccel,
    movingProfile: a === 'z' && g.zMode === 'profile' ? { driveMass: g.motorMass.z } : undefined,
  }
}
