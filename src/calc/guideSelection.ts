// Guides without drive (data/guides): the EAGF guide unit on an electric cylinder (ESBF with 외부 가이드 사용) and
// the guide axes EGC-FA / ELFD beside an EGC / ELGD in place of LM guides. Order code, masses and the load checks.
import type { Axis, GuideUnit } from '../data/types'
import type { GuideLoads } from './axisSelection'
import { check, type Check } from './types'

export interface GuideFit {
  guide: GuideUnit
  /** mm, ordered stroke */
  stroke: number
  /** order type with the stroke, and its part number (a standard stroke's own, else the module number) */
  model: string
  partNumber: string
  /** units in the arrangement (guide axes: one per LM guide position; EAGF: 1) */
  count: number
  /** kg, moving mass of one unit (EAGF: yoke plate and guide rods at the ordered stroke) */
  movingMass: number
  /** kg, mass of one unit */
  mass: number
  /** the guide's slide differs from the axis's (EGC GV beside EGC-FA GK: no GV load values) */
  otherSlide: boolean
}

const fits = (g: GuideUnit, axis: Axis) => g.axes.some((a) => a.family === axis.family && a.variant === axis.variant && a.size === axis.size)

function fitOf(guide: GuideUnit, stroke: number, count: number, otherSlide: boolean): GuideFit {
  const s = Math.max(0, Math.ceil(stroke))
  const own = guide.strokePartNumbers?.[String(s)]
  return {
    guide,
    stroke: s,
    model: guide.typeCode.replace('…', String(s)),
    partNumber: own ?? guide.moduleNumber,
    count,
    movingMass: guide.movingMass + ((guide.movingMassPer10mm ?? 0) * s) / 10,
    mass: guide.baseMass + (guide.massPer10mm * s) / 10,
    otherSlide,
  }
}

/** The EAGF for an electric cylinder at its ordered stroke; null for other axes or sizes without one. */
export function cylinderGuideFor(axis: Axis, stroke: number, guides: GuideUnit[]): GuideFit | null {
  const g = guides.find((u) => u.kind === 'cylinder' && fits(u, axis))
  return g ? fitOf(g, stroke, 1, false) : null
}

/** The guide axis of the axis's profile and slide (else its standard slide), `count` of them; null when none fits. */
export function guideAxisFor(axis: Axis, stroke: number, count: number, guides: GuideUnit[]): GuideFit | null {
  const long = axis.longSlide || axis.slide === 'GV'
  const list = guides.filter((u) => u.kind === 'axis' && fits(u, axis))
  const g = list.find((u) => u.longSlide === long) ?? list.find((u) => !u.longSlide)
  return g ? fitOf(g, stroke, count, g.longSlide !== long) : null
}

/** Load comparison factor fv = Σ |F_i / F_max,i| against the guide's fv values */
export function guideFv(loads: GuideLoads, g: GuideUnit): number {
  return (
    Math.abs(loads.Fy) / g.FyMax +
    Math.abs(loads.Fz) / g.FzMax +
    Math.abs(loads.Mx) / g.MxMax +
    Math.abs(loads.My) / g.MyMax +
    Math.abs(loads.Mz) / g.MzMax
  )
}

/**
 * EAGF loads at the guide centre (Festo's calculation example, EAGF for ESBF): payload and the guide's moving mass
 * together, their centre of gravity Lb_total from the yoke plate (+ payload side, − guide side; the payload's at
 * `cog.x`), the lever X + extension + Lb_total at the end of the stroke. Forces across the rod from the slide forces
 * (`forces`: travel, lateral, normal of the whole moving mass); the payload's offsets across the rod add Mx and,
 * with the travel force, My / Mz.
 */
export function eagfLoads(
  fit: GuideFit,
  payload: number,
  cog: { x: number; y: number; z: number },
  extension: number,
  forces: { travel: number; lateral: number; normal: number },
): GuideLoads {
  const g = fit.guide
  const mb = fit.movingMass
  const total = payload + mb
  const [l0, per10] = g.cogMoving ?? [0, 0]
  const lb = l0 + (per10 * fit.stroke) / 10
  const lTotal = total > 0 ? (cog.x * payload - lb * mb) / total : 0
  const arm = ((g.distanceX ?? 0) + extension + lTotal) / 1000
  const y = total > 0 ? (Math.abs(cog.y) * payload) / total / 1000 : 0
  const z = total > 0 ? (Math.abs(cog.z) * payload) / total / 1000 : 0
  const Fy = forces.lateral
  const Fz = forces.normal
  return {
    Fy,
    Fz,
    Mx: y * Fz + z * Fy,
    My: Math.abs(Fz * arm) + z * forces.travel,
    Mz: Math.abs(Fy * arm) + y * forces.travel,
  }
}

const KEYS = ['Fy', 'Fz', 'Mx', 'My', 'Mz'] as const

/** Check labels: EAGF (guide unit) and guide axes */
const LABELS = {
  cylinder: {
    stroke: '가이드 유닛 스트로크',
    speed: '가이드 유닛 최대 속도',
    acceleration: '가이드 유닛 최대 가속도',
    static: '가이드 유닛 정적 최대 하중',
    fv: '가이드 유닛 하중 비교값 fv',
  },
  axis: {
    stroke: '가이드 축 스트로크',
    speed: '가이드 축 최대 속도',
    acceleration: '가이드 축 최대 가속도',
    static: '가이드 축 정적 최대 하중',
    fv: '가이드 축 하중 비교값 fv',
  },
}

/**
 * Checks of the guide: stroke within its range, speed / acceleration within its limits (where given), EAGF static
 * max. values (largest share), and fv of the most loaded unit against 1 (5000 km). All hard limits.
 */
export function guideChecks(fit: GuideFit, loads: GuideLoads, velocity: number, acceleration: number): Check[] {
  const g = fit.guide
  const label = LABELS[g.kind]
  const checks: Check[] = [
    { ...check(label.stroke, fit.stroke, g.strokeRange[1], 'mm'), note: '{model}', noteArgs: { model: fit.model } },
  ]
  if (g.maxSpeed) checks.push(check(label.speed, velocity, g.maxSpeed, 'm/s'))
  if (g.maxAcceleration) checks.push(check(label.acceleration, acceleration, g.maxAcceleration, 'm/s²'))
  if (g.staticMax) {
    const s = g.staticMax
    const key = KEYS.reduce((a, b) => (Math.abs(loads[b]) / s[b] > Math.abs(loads[a]) / s[a] ? b : a))
    checks.push({
      ...check(label.static, Math.abs(loads[key]), s[key], key.startsWith('F') ? 'N' : 'Nm'),
      note: '가장 큰 비율: {key}',
      noteArgs: { key },
    })
  }
  const fv = guideFv(loads, g)
  checks.push({
    ...check(label.fv, fv, 1, ''),
    ...(fit.count > 1 ? { note: '{n}개 중 가장 큰 하중 기준', noteArgs: { n: fit.count } } : {}),
    ...(fit.otherSlide ? { note: '가이드 축 표준 슬라이드 하중값 기준 (긴 슬라이드 값 없음)' } : {}),
  })
  return checks
}
