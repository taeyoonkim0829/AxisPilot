import type { Axis, AxisFamily, Motor, ThirdPartyAxis } from '../data/types'
import { G, guideComparisonValue, guideLoads } from './axisSelection'
import type { Mounting, Requirements } from './types'

/**
 * 제품 비교: another maker's product (the reference) against the Festo products that could replace it, on their
 * data alone (no sizing calculation). Candidates are sorted by how close their main data are to the reference's
 * (sum of |log ratio| over the compared values), spec rows give the Festo product's value against the reference's
 * (= 100%).
 */

/** One row of the side by side table: numbers (with the ratio other / reference: the Festo product's value against
 *  the compared product's, which is 100%) or texts where they cannot be put on one scale (a payload in kg against
 *  forces in N) */
export interface SpecRow {
  label: string
  unit: string
  reference: number | string | null
  other: number | string | null
  /** other / reference (compared product = 100%); null where either is missing or not a number */
  ratio: number | null
  /** the condition the values hold for, an i18n key with `noteArgs` */
  note?: string
  noteArgs?: Record<string, string | number>
}

const row = (label: string, unit: string, reference: number | string | null, other: number | string | null): SpecRow => ({
  label,
  unit,
  reference,
  other,
  ratio: typeof reference === 'number' && typeof other === 'number' && reference > 0 ? other / reference : null,
})

/** |log| of the ratio, so twice and half are as far off; missing values count as far */
const off = (a: number | null | undefined, b: number | null | undefined) => (a && b && a > 0 && b > 0 ? Math.abs(Math.log(a / b)) : 1)

// ---------- axes ----------

/** The Festo axis families compared with linear axes (the electric cylinder ESBF is not one) */
export const COMPARE_AXIS_FAMILIES: AxisFamily[] = ['ELGT', 'ELGD', 'EGC']

export interface AxisCandidateFilter {
  drive: Axis['drive']
  families: AxisFamily[]
  /** only axes reaching the reference's longest stroke and highest speed */
  atLeast: boolean
}

/** Festo axes that could replace `ref`, closest first */
export function axisCandidates(ref: ThirdPartyAxis, axes: Axis[], filter: AxisCandidateFilter): Axis[] {
  const lead = (a: Axis) => (a.drive === 'spindle' ? a.spindlePitch : null)
  const score = (a: Axis) =>
    off(a.maxStroke, ref.strokeMax) + off(a.maxSpeed, ref.maxSpeed) + (ref.drive === 'spindle' ? off(lead(a), ref.screwLead) : 0)
  return axes
    .filter(
      (a) =>
        a.drive === filter.drive &&
        filter.families.includes(a.family) &&
        (!filter.atLeast || (a.maxStroke >= ref.strokeMax && a.maxSpeed >= ref.maxSpeed)),
    )
    .map((a) => ({ a, s: score(a) }))
    .sort((x, y) => x.s - y.s || x.a.model.localeCompare(y.a.model))
    .map((x) => x.a)
}

/** The data side by side: stroke, speed, the ball screw (diameter, lead), load ratings and the motor */
export function axisSpecRows(ref: ThirdPartyAxis, festo: Axis): SpecRow[] {
  const rows = [row('최대 스트로크', 'mm', ref.strokeMax, festo.maxStroke), row('최고 속도', 'm/s', ref.maxSpeed, festo.maxSpeed)]
  if (ref.drive === 'spindle')
    rows.push(
      row('볼스크류 직경', 'mm', ref.screwDiameter, festo.spindleDiameter ?? null),
      row('볼스크류 리드', 'mm', ref.screwLead, festo.spindlePitch ?? null),
    )
  else rows.push(row('벨트', '', ref.belt, null))
  const load = ref.payload ? `${ref.payload[0]} / ${ref.payload[1]} kg (0.3G / 0.5G)` : `${ref.maxPayload} kg`
  const forces = festo.FyMax != null && festo.FzMax != null ? `Fy / Fz ${festo.FyMax} / ${festo.FzMax} N` : null
  rows.push(row('하중 정격', '', load, forces))
  // The catalog gives no feed force: the built-in motor's rated torque through the ball screw
  const thrust = ref.drive === 'spindle' && ref.screwLead ? Math.round(estimatedThrust(ref.motorPower, ref.screwLead)) : null
  rows.push({
    ...row('최대 이송력', 'N', thrust, festo.maxFeedForce || null),
    ...(thrust != null ? { note: '로보스타: 모터 정격 토크 × 볼스크류로 추정 (정격 {rpm} rpm, 효율 {eta})', noteArgs: { rpm: RATED_RPM, eta: SCREW_EFFICIENCY } } : {}),
  })
  // The catalog's moment ratings as allowable overhangs: the Festo axis's at the same payload and acceleration
  for (const o of ref.overhang ?? []) {
    const note = { note: OVERHANG_NOTE[o.mounting], noteArgs: { kg: o.payload, g: OVERHANG_G } }
    const overhangRow = (label: string, reference: number, direction: 'lateral' | 'normal') => {
      const festoMm = festoOverhang(festo, o.mounting, o.payload, direction)
      const r = row(label, 'mm', reference, festoMm)
      // beyond the search: the gauge stays full, the value says so
      return { ...r, ...note, ...(festoMm === OVERHANG_MAX ? { other: `≥ ${OVERHANG_MAX} mm` } : {}) }
    }
    rows.push(overhangRow('허용 오버행 0°', o.lateral, 'lateral'), overhangRow('허용 오버행 90°', o.normal, 'normal'))
  }
  rows.push(row('모터', '', `${ref.motorPower} W`, null))
  return rows
}

/** AC servo rated speed taken for the built-in motor (the catalog gives the power only) */
const RATED_RPM = 3000
const SCREW_EFFICIENCY = 0.9
/** N: F = 2π · T · η / lead with T = P / ω at the rated speed */
export const estimatedThrust = (powerW: number, leadMm: number) =>
  (2 * Math.PI * (powerW / ((RATED_RPM * 2 * Math.PI) / 60)) * SCREW_EFFICIENCY) / (leadMm / 1000)

/** acceleration of the overhang ratings: the catalog's rated payload is the one at 0.3 G */
const OVERHANG_G = 0.3
const OVERHANG_NOTE: Record<Mounting, string> = {
  floor: '수평 설치, 부하 {kg} kg, {g} G',
  wall: '벽면 설치, 부하 {kg} kg, {g} G',
  vertical: '수직 설치, 부하 {kg} kg, {g} G',
}
/** the furthest overhang searched, mm */
const OVERHANG_MAX = 5000

/**
 * mm: how far the COG of `payload` may sit from the Festo axis's slide surface (0° across the travel, 90° along the
 * slide normal) before the guide comparison value reaches 1, at the overhang ratings' acceleration
 */
export function festoOverhang(axis: Axis, mounting: Mounting, payload: number, direction: 'lateral' | 'normal'): number | null {
  if (!axis.FyMax || !axis.FzMax || !axis.MxMax || !axis.MyMax || !axis.MzMax) return null
  const mass = payload + axis.slideMass
  const fv = (l: number) => {
    const req = { mounting, cog: { x: 0, y: direction === 'lateral' ? l : 0, z: direction === 'normal' ? l : 0 } } as Requirements
    return guideComparisonValue(guideLoads(req, mass, OVERHANG_G * G, axis.guideCentre ?? 0), axis).fv
  }
  if (fv(0) >= 1) return 0
  if (fv(OVERHANG_MAX) < 1) return OVERHANG_MAX
  let lo = 0
  let hi = OVERHANG_MAX
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2
    if (fv(mid) < 1) lo = mid
    else hi = mid
  }
  return Math.floor(lo)
}

// ---------- motors ----------

export type SupplyClass = 'AC 380–480 V' | 'AC 200–240 V' | 'DC'
export const supplyOf = (m: Motor): SupplyClass | null =>
  m.voltage == null ? null : m.voltage >= 380 ? 'AC 380–480 V' : m.voltage >= 100 ? 'AC 200–240 V' : 'DC'

export interface MotorCandidateFilter {
  families: string[]
  supply: SupplyClass | null
  /** rated power within -25 % / +33 % of the reference's */
  samePower: boolean
  /** the same mounting interface code (the same kits fit) */
  sameInterface: boolean
}

/** Festo motors that could replace `ref` (with a brake if it has one), closest first */
export function motorCandidates(ref: Motor, motors: Motor[], filter: MotorCandidateFilter): Motor[] {
  const score = (m: Motor) => off(m.ratedTorque, ref.ratedTorque) + 0.5 * off(m.peakTorque, ref.peakTorque) + 0.3 * off(m.maxSpeed, ref.maxSpeed)
  return motors
    .filter(
      (m) =>
        m.maker === 'Festo' &&
        m.brake === ref.brake &&
        filter.families.includes(m.family) &&
        (!filter.supply || supplyOf(m) === filter.supply) &&
        (!filter.samePower || (m.ratedPower != null && ref.ratedPower != null && m.ratedPower >= ref.ratedPower * 0.75 && m.ratedPower <= ref.ratedPower * 1.33)) &&
        (!filter.sameInterface || (m.interfaceCode != null && m.interfaceCode === ref.interfaceCode)),
    )
    .map((m) => ({ m, s: score(m) }))
    .sort((x, y) => x.s - y.s || x.m.model.localeCompare(y.m.model))
    .map((x) => x.m)
}

export function motorSpecRows(ref: Motor, festo: Motor): SpecRow[] {
  return [
    row('정격 출력', 'W', ref.ratedPower, festo.ratedPower),
    row('정격 토크', 'Nm', ref.ratedTorque, festo.ratedTorque),
    row('최대 토크', 'Nm', ref.peakTorque, festo.peakTorque),
    row('정격 회전수', 'rpm', ref.ratedSpeed, festo.ratedSpeed),
    row('최고 회전수', 'rpm', ref.maxSpeed, festo.maxSpeed),
    row('회전자 관성', 'kg·cm²', ref.inertia, festo.inertia),
    row('질량', 'kg', ref.mass ?? null, festo.mass ?? null),
    row('전원', '', supplyOf(ref), supplyOf(festo)),
    row('인터페이스', '', ref.interfaceCode, festo.interfaceCode),
  ]
}
