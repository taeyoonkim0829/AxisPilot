import { describe, expect, it } from 'vitest'
import { axes, motors } from '../data'
import { evaluateAxis, screwLoadFactor, slideGroupLoads, SCREW_LIFE_MIN_KM } from './axisSelection'
import { evaluateDrive } from './motorSelection'
import { defaultSettings, type Requirements, type Settings } from './types'

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
    const ev = run('ESBF-BS-32-…-10P', { stroke: 100, payload: 0.1, velocity: 0.2 }, { externalGuide: true })
    const life = infoOf(ev, '볼스크류 예상 수명')
    expect(life.value).toBeCloseTo(2000, 6)
    expect(life.alert).toBe(true)
    const c = checkOf(ev.checks, '볼스크류 수명')!
    expect(c.status).toBe('warn')
    expect(c.limit).toBe(SCREW_LIFE_MIN_KM)
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
