import { axisSeries, type Axis, type AxisSeries, type Motor, type MotorOptions, type MotorVariant, type ThirdPartyAxis } from '../data/types'
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
export const COMPARE_AXIS_FAMILIES: AxisSeries[] = ['ELGT', 'ELGD', 'EGC', 'EGC-HD']

export interface AxisCandidateFilter {
  drive: Axis['drive']
  families: AxisSeries[]
  /** only axes reaching the reference's longest stroke and highest speed */
  atLeast: boolean
}

/** Robostar order options: stroke (mm), encoder I incremental / A absolute, PR / PL for the parallel models */
export interface RobostarOptions {
  stroke: number
  encoder: 'A' | 'I'
  hand: 'R' | 'L'
}

/** The strokes a Robostar axis is ordered at: 50 mm steps (the catalog's codes 010, 055, 115) within its range */
export const robostarStrokes = (a: ThirdPartyAxis) =>
  Array.from({ length: Math.floor((a.strokeMax - a.strokeMin) / 50) + 1 }, (_, i) => a.strokeMin + 50 * i)

/**
 * A Robostar ball screw axis's full model (catalog "ROBOT Ordering method": model, stroke in 10 mm (3 digits),
 * encoder I / A, motor W with B for brake, e.g. RS-120-X20SS-055-A-200; the A1-OO option codes are left out);
 * null for the belt types, whose data name neither the axis nor the type.
 * shortcut: the catalog shows the fields but no written example, so the hyphens between them are assumed.
 */
export function robostarModel(a: ThirdPartyAxis, o: RobostarOptions): string | null {
  if (a.drive !== 'spindle') return null
  const model = a.model.replace(/ \(Long\)$/, '').replace(/PR \(L\)$/, o.hand === 'L' ? 'PL' : 'PR')
  const motor = a.brake ? `${String(a.motorPower).slice(0, 2)}B` : String(a.motorPower)
  return `${model}-${String(Math.round(o.stroke / 10)).padStart(3, '0')}-${o.encoder}-${motor}`
}

/** Every full model a Robostar axis is ordered as, with its options (none for the belt types) */
export function robostarModels(a: ThirdPartyAxis): { model: string; options: RobostarOptions }[] {
  if (a.drive !== 'spindle') return []
  const hands: RobostarOptions['hand'][] = a.layout === 'PR' ? ['R', 'L'] : ['R']
  return robostarStrokes(a).flatMap((stroke) =>
    (['A', 'I'] as const).flatMap((encoder) =>
      hands.map((hand) => {
        const options = { stroke, encoder, hand }
        return { model: robostarModel(a, options)!, options }
      }),
    ),
  )
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
        filter.families.includes(axisSeries(a)) &&
        (!filter.atLeast || (a.maxStroke >= ref.strokeMax && a.maxSpeed >= ref.maxSpeed)),
    )
    .map((a) => ({ a, s: score(a) }))
    .sort((x, y) => x.s - y.s || x.a.model.localeCompare(y.a.model))
    .map((x) => x.a)
}

/** The data side by side: stroke, speed, the ball screw (diameter, lead), load ratings and the motor */
export function axisSpecRows(ref: ThirdPartyAxis, festo: Axis): SpecRow[] {
  const rows = [row('최대 스트로크', 'mm', ref.strokeMax, festo.maxStroke), row('최고 속도', 'm/s', ref.maxSpeed, festo.maxSpeed)]
  if (ref.drive === 'spindle') {
    const screw = (d: number | null | undefined, lead: number | null | undefined) =>
      d == null && lead == null ? null : `Ø${d ?? '—'} / ${lead ?? '—'} mm`
    const r = row('볼스크류 Ø / 리드', '', screw(ref.screwDiameter, ref.screwLead), screw(festo.spindleDiameter, festo.spindlePitch))
    if (r.reference != null || r.other != null) rows.push(r)
  } else rows.push(row('벨트', '', ref.belt, null))
  const load = ref.payload ? `${ref.payload[0]} / ${ref.payload[1]} kg (0.3G / 0.5G)` : `${ref.maxPayload} kg`
  const forces = festo.FyMax != null && festo.FzMax != null ? `Fy / Fz ${festo.FyMax} / ${festo.FzMax} N` : null
  rows.push(row('하중 정격', '', load, forces))
  // The catalog gives no feed force: the built-in motor's rated torque through the ball screw
  const thrust = ref.drive === 'spindle' && ref.screwLead ? Math.round(estimatedThrust(ref.motorPower, ref.screwLead)) : null
  rows.push({
    ...row('최대 이송력', 'N', thrust, festo.maxFeedForce || null),
    ...(thrust != null ? { note: '로보스타: 모터 사양 고정으로 제한됨 (모터 정격 토크 × 볼스크류로 추정, 정격 {rpm} rpm, 효율 {eta})', noteArgs: { rpm: RATED_RPM, eta: SCREW_EFFICIENCY } } : {}),
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
    rows.push(overhangRow('모멘트 한계 거리 y', o.lateral, 'lateral'), overhangRow('모멘트 한계 거리 z', o.normal, 'normal'))
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

/** The order options a compared motor is offered with (the first of each is its default) */
export interface ReferenceOptions {
  shaft: MotorOptions['shaft'][]
  seal: boolean[]
  encoder: MotorOptions['encoder'][]
}

/** the model without the data's bracketed suffixes (`(230V)`, `(200V)`, `(48V)`, `(brake)`) */
const baseModel = (m: Motor) => m.model.replace(/( \([^)]*\))+$/, '')
const LS_M3 = /^APM-FGP?(110D|110G|150G)$/

/**
 * The options a compared motor's full model name takes, null where it has none (1FL6: the model is the full
 * article number). Mitsubishi and LS encoders are absolute multi-turn (battery backed) by standard, so the
 * encoder is fixed to multi-turn there.
 */
export function referenceOptions(m: Motor): ReferenceOptions | null {
  const both = { shaft: ['plain', 'key'] as MotorOptions['shaft'][], seal: [false, true] }
  if (m.family === '1FK2') return { ...both, encoder: ['multi', 'single'] }
  if (m.maker === 'Mitsubishi' && /^H[GK]-/.test(m.family)) {
    const base = baseModel(m)
    // HG-KR: oil seal from 0.1 kW, keyed shaft only on 200 / 400 / 750 W; HG-JR: oil seal as standard
    const kr = m.family === 'HG-KR'
    return {
      shaft: kr && !/^HG-KR(23|43|73)/.test(base) ? ['plain'] : both.shaft,
      seal: m.family === 'HG-JR' ? [true] : kr && /^HG-KR053/.test(base) ? [false] : both.seal,
      encoder: ['multi'],
    }
  }
  if (m.maker === 'LS') {
    // F series 40 □ (FAL): no oil seal
    return { shaft: ['key', 'plain'], seal: /-FAL/.test(m.model) ? [false] : both.seal, encoder: ['multi'] }
  }
  return null
}

/** The options within what the motor is offered with (a value it lacks becomes its default) */
export function offeredOptions(m: Motor, o: MotorOptions): MotorOptions {
  const r = referenceOptions(m)
  if (!r) return o
  return {
    shaft: r.shaft.includes(o.shaft) ? o.shaft : r.shaft[0],
    seal: r.seal.includes(o.seal) ? o.seal : r.seal[0],
    encoder: r.encoder.includes(o.encoder) ? o.encoder : r.encoder[0],
  }
}

/** Every full model name the compared motor is offered as, with its options (none: no order options) */
export function fullModels(m: Motor): { model: string; options: MotorOptions }[] {
  const r = referenceOptions(m)
  if (!r) return []
  return r.shaft.flatMap((shaft) =>
    r.seal.flatMap((seal) =>
      r.encoder.map((encoder) => {
        const options = { shaft, seal, encoder }
        return { model: fullModel(m, options) ?? m.model, options }
      }),
    ),
  )
}

/**
 * The compared motor's full model name for the order options (null: no options, the model is the full name).
 * - Siemens 1FK2: the model is the article number up to the brake digit; positions read from Siemens's
 *   per-article data sheets: 13th IP64 0 / IP65 (shaft seal) 1, 14th plain shaft 0 / fitted key 1, 15th encoder
 *   AS22DQC S / AM22DQC M, then A0.
 * - Mitsubishi HG / HK (MR-J4 / MR-J5 catalogs' model designation): the model (with B for the brake), then J for
 *   the oil seal (not on HG-JR, which has it as standard) and K for the keyed shaft.
 * - LS APM (Xmotion catalog type key): the model, the encoder (E series M3; F series M, FAL M8, FG(P)110D / 110G /
 *   150G M3), the shaft K (key, standard) or N (straight), the option digit (1 oil seal, 2 brake, 3 both) and
 *   8 for the 48 V DC motors.
 */
export function fullModel(m: Motor, options: MotorOptions): string | null {
  if (!referenceOptions(m)) return null
  const o = offeredOptions(m, options)
  const base = baseModel(m)
  if (m.family === '1FK2') return `${base}${o.seal ? 1 : 0}-${o.shaft === 'key' ? 1 : 0}${o.encoder === 'multi' ? 'M' : 'S'}A0`
  if (m.maker === 'Mitsubishi') return `${base}${o.seal && m.family !== 'HG-JR' ? 'J' : ''}${o.shaft === 'key' ? 'K' : ''}`
  const encoder = m.family === 'APM-E' || LS_M3.test(base) ? 'M3' : /-FAL/.test(base) ? 'M8' : 'M'
  const option = (o.seal ? 1 : 0) + (m.brake ? 2 : 0)
  return `${base}${encoder}${o.shaft === 'key' ? 'K' : 'N'}${option || ''}${m.voltage === 48 ? 8 : ''}`
}

export interface VariantMatch {
  variant: MotorVariant | null
  /** options the Festo motor is not offered with (the variant is the nearest) */
  differs: (keyof MotorOptions)[]
}

/** The Festo motor's order variant closest to the options (fewest differences, encoder first) */
export function festoVariant(m: Motor, o: MotorOptions): VariantMatch {
  const keys: (keyof MotorOptions)[] = ['encoder', 'shaft', 'seal']
  const diff = (v: MotorVariant) => keys.filter((k) => v[k] !== o[k])
  const weight = (v: MotorVariant) => diff(v).reduce((s, k) => s + (k === 'encoder' ? 4 : k === 'shaft' ? 2 : 1), 0)
  const variant = [...(m.variants ?? [])].sort((a, b) => weight(a) - weight(b))[0] ?? null
  return { variant, differs: variant ? diff(variant) : [] }
}

const SHAFT_TEXT = { plain: '평축', key: '키 축' } as const
const ENCODER_TEXT = { single: '싱글턴', multi: '멀티턴', none: '없음' } as const

/** The order option rows: the compared motor's choice and the Festo variant's */
export function motorOptionRows(o: MotorOptions, v: MotorVariant | null, refBrake: boolean, festoBrake: boolean): SpecRow[] {
  const seal = (s: boolean) => (s ? '있음' : '없음')
  return [
    row('축 끝', '', SHAFT_TEXT[o.shaft], v ? SHAFT_TEXT[v.shaft] : null),
    row('축 씰', '', seal(o.seal), v ? seal(v.seal) : null),
    row('엔코더', '', ENCODER_TEXT[o.encoder], v ? ENCODER_TEXT[v.encoder] : null),
    row('브레이크', '', seal(refBrake), seal(festoBrake)),
  ]
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
