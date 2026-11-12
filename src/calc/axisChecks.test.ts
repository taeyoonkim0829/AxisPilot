import { describe, expect, it } from 'vitest'
import { axes, motors, sensors } from '../data'
import { evaluateAxis, screwLoadFactor, slideGroupLoads, SCREW_LIFE_MIN_KM } from './axisSelection'
import { evaluateDrive } from './motorSelection'
import { defaultParallel, defaultPress, defaultSettings, type Requirements, type Settings } from './types'

// The checks that warn or fail an axis or motor, against their formulas worked out by hand (CLAUDE.md, "Calculation
// reference"): deflection, ball screw life, inertia ratio, regeneration, loads spread over additional slides.

const req: Requirements = { stroke: 500, velocity: 0.5, acceleration: 2, jerk: 0, payload: 10, cog: { x: 0, y: 0, z: 0 }, mounting: 'floor' }
const axis = (id: string) => axes.find((a) => a.id === id)!
const run = (id: string, r: Partial<Requirements> = {}, s: Partial<Settings> = {}) =>
  evaluateAxis(axis(id), { ...req, ...r }, { ...defaultSettings, ...s })!
const checkOf = (checks: { label: string }[], label: string) => checks.find((c) => c.label === label) as
  | { label: string; value: number; limit: number | null; status: string; note?: string }
  | undefined
const infoOf = (ev: ReturnType<typeof run>, label: string) => ev.info.find((i) => i.label === label)!

describe('deflection', () => {
  it('is a simply supported beam with the moving mass in the middle and the axis weight spread', () => {
    // ELGT-BS-90, floor: Iy 631000 mm⁴, E 70000 N/mm²; supported every 1000 mm (shorter than the axis)
    const ev = run('ELGT-BS-90-…20P', {}, { supportSpan: 1000 })
    const L = 1000
    const EI = 70000 * 631000
    const length = 500 + 230 // stroke + base length
    const point = infoOf(ev, '이동 질량 (부하 + 슬라이드)').value * 9.81
    const self = infoOf(ev, '축 질량').value * 9.81 * (L / length > 1 ? 1 : L / length)
    const expected = (point * L ** 3) / (48 * EI) + (5 * self * L ** 3) / (384 * EI)
    expect(checkOf(ev.checks, '처짐')!.value).toBeCloseTo(expected, 6)
  })

  it('only warns beyond the allowed deflection (an intermediate support fixes it)', () => {
    const c = checkOf(run('ELGT-BS-90-…20P', { payload: 60 }, { supportSpan: 4000 }).checks, '처짐')!
    expect(c.value).toBeGreaterThan(c.limit!)
    expect(c.status).toBe('warn')
  })

  it('is not checked on a vertical axis', () => {
    expect(checkOf(run('ELGT-BS-90-…20P', { mounting: 'vertical' }).checks, '처짐')).toBeUndefined()
  })
})

describe('ball screw life', () => {
  it('takes the load factor fw by peak speed', () => {
    expect([0.25, 0.26, 1, 1.01, 2, 2.01].map(screwLoadFactor)).toEqual([1.2, 1.5, 1.5, 2, 2, 3.5])
  })

  it('ends after the switching cycles on an ESBF, and warns under the minimum', () => {
    // ESBF-BS-32: 10 million round trips of 100 mm = 2000 km, far below the load life of a 0.1 kg payload
    const ev = run('ESBF-BS-32-…-10P', { stroke: 100, payload: 0.1, velocity: 0.2, parallel: { ...defaultParallel, mode: 'guides' as const, guideAxis: true } })
    const life = infoOf(ev, '볼스크류 예상 수명')
    expect(life.value).toBeCloseTo(2000, 6)
    expect(life.alert).toBe(true)
    const c = checkOf(ev.checks, '볼스크류 수명')!
    expect(c.status).toBe('warn')
    expect(c.limit).toBe(SCREW_LIFE_MIN_KM)
  })

  it('warns when the ESBF sensor brackets do not fit the sensor mounting area', () => {
    // ESBF-63: body 171 + stroke, L1 33, L2 99: 39 + stroke for 3 brackets of 27 mm -> stroke 42 at least
    const settings = { ...defaultSettings, sensors: true, homeContact: 'NO' as const }
    const at = (stroke: number) =>
      checkOf(evaluateAxis(axis('ESBF-BS-63-…-5P'), { ...req, stroke, velocity: 0.1 }, settings, [], [], sensors)!.checks, '센서 장착 구간')
    const short = at(30)!
    expect(short.status).toBe('warn')
    expect(short.value).toBe(69)
    expect(short.limit).toBe(81)
    expect(at(42)).toBeUndefined()
  })

  it('takes the press-in operating coefficient while pressing, and warns on an ESBF stroke under 2.5 pitches', () => {
    const base = { stroke: 200, payload: 5, velocity: 0.1, parallel: { ...defaultParallel, mode: 'guides' as const, guideAxis: true } }
    expect(checkOf(run('ESBF-BS-50-…-10P', base).checks, '최소 이동 거리')).toBeUndefined()
    const short = checkOf(run('ESBF-BS-50-…-20P', { ...base, stroke: 45 }).checks, '최소 이동 거리')!
    expect(short.status).toBe('warn')
    expect(short.limit).toBe(50)
    // pressing with no force at the same speed: the about the same Fxm, fw 1.5 instead of 1.2 (v ≤ 0.25 m/s); a vertical
    // 100 kg load keeps the load life under the switching cycles' 16000 km
    const heavy = { ...base, stroke: 800, payload: 100, mounting: 'vertical' as const }
    const loaded = infoOf(run('ESBF-BS-50-…-10P', heavy), '볼스크류 예상 수명').value
    const pressed = infoOf(run('ESBF-BS-50-…-10P', { ...heavy, press: { ...defaultPress, enabled: true, force: 0, distance: 20, speed: 0.1, holdTime: 0 } }), '볼스크류 예상 수명').value
    // (1.2 / 1.5)³ = 0.51; the press move's own profile changes Fxm a little
    expect(pressed / loaded).toBeGreaterThan(0.45)
    expect(pressed / loaded).toBeLessThan(0.65)
  })

  it('gives no warning above the minimum', () => {
    const ev = run('ELGT-BS-90-…20P', { payload: 1 })
    expect(infoOf(ev, '볼스크류 예상 수명').value).toBeGreaterThan(SCREW_LIFE_MIN_KM)
    expect(checkOf(ev.checks, '볼스크류 수명')).toBeUndefined()
  })
})

describe('motor checks', () => {
  const ev = run('ELGT-BS-90-…20P')
  const motor = motors.find((m) => m.model === 'EMMT-AS-60-S-HS')!

  it('inertia ratio: load inertia at the motor (axis + coupling) over the rotor inertia', () => {
    const c = checkOf(evaluateDrive(ev, motor, null, defaultSettings).checks, '관성비')!
    expect(c.value).toBeCloseTo((ev.inertia + defaultSettings.couplingInertia) / motor.inertia, 9)
    expect(c.limit).toBe(motor.allowableInertiaRatio ?? defaultSettings.defaultInertiaRatio)
  })

  it('regeneration warns when the braking power exceeds what the motor takes, and grows with the load', () => {
    const m = motors.find((x) => x.reverseEfficiency != null && (x.regenPower ?? 0) > 0)!
    const regen = (payload: number) =>
      checkOf(evaluateDrive(run('ELGT-BS-90-…20P', { mounting: 'vertical', payload, velocity: 1, acceleration: 10 }), m, null, defaultSettings).checks, '회생 전력')
    const light = regen(1)
    const heavy = regen(40)!
    expect(heavy.value).toBeGreaterThan(light?.value ?? 0)
    expect(heavy.status).toBe(heavy.value > m.regenPower! ? 'warn' : 'ok')
  })
})

describe('additional slides', () => {
  it('turn pitch and yaw into opposing forces across the slides and share the rest', () => {
    // two slides 200 mm apart: My 40 Nm over ±0.1 m = ±200 N, Mz 20 Nm = ±100 N on the outer slide
    const loads = slideGroupLoads({ Fy: 100, Fz: 200, Mx: 10, My: 40, Mz: 20 }, [-0.1, 0.1])
    expect(loads).toEqual({ Fy: 50 + 100, Fz: 100 + 200, Mx: 5, My: 0, Mz: 0 })
  })

  it('leave a single slide alone', () => {
    const loads = { Fy: 1, Fz: 2, Mx: 3, My: 4, Mz: 5 }
    expect(slideGroupLoads(loads, [0])).toBe(loads)
  })
})

describe('ball screw support', () => {
  it('orders ELGD-BS -SU with its speed curve and no-load torque', () => {
    const r = { stroke: 1000, velocity: 0.7 }
    const plain = run('ELGD-BS-KF-80-…10P', r)
    expect(checkOf(plain.checks, '속도')!.status).toBe('fail')
    const su = run('ELGD-BS-KF-80-…10P', r, { spindleSupport: true })
    expect(su.spindleSupport).toBe(true)
    expect(su.order.model).toBe('ELGD-BS-KF-80-1000-0H-10P-SU')
    expect(su.order.partNumber).toBe('8176875')
    expect(checkOf(su.checks, '속도')!.limit).toBeGreaterThan(0.7)
    expect(su.noLoadTorque).toBe(0.35)
    expect(plain.noLoadTorque).toBe(0.269)
  })

  it('gives EGC-BS -S full speed, only above its minimum stroke', () => {
    const su = run('EGC-80-...-BS-10P-KF-GK', { stroke: 1500 }, { spindleSupport: true })
    expect(su.order.model).toBe('EGC-80-1500-BS-10P-S-KF-0H-ML-GK')
    expect(checkOf(su.checks, '속도')!.limit).toBe(0.5)
    expect(checkOf(run('EGC-80-...-BS-10P-KF-GK', { stroke: 1500 }).checks, '속도')!.limit).toBeLessThan(0.3)
    const short = run('EGC-80-...-BS-10P-KF-GK', { stroke: 700 }, { spindleSupport: true })
    expect(short.spindleSupport).toBe(false)
    expect(infoOf(short, '스핀들 서포트').noteArgs).toEqual({ min: 780 })
  })
})
