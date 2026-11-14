// Boundary conditions of the sizing: every axis and motor through extreme and degenerate inputs. Whatever the
// input, a result is either absent or made of finite numbers, and the loads grow with the load.
import { describe, expect, it } from 'vitest'
import { axes, gearboxes, guides, kits, motors, shafts } from '../data'
import { evaluateAxis, guideLoads, type AxisEvaluation } from './axisSelection'
import { attachKit } from './kitSelection'
import { moveProfile, samplePhases, tracePhases } from './motionProfile'
import { evaluateDrive, gearboxOptionsFor } from './motorSelection'
import { defaultParallel, defaultPress, defaultSettings, type Check, type Requirements, type Settings } from './types'

const settings: Settings = { ...defaultSettings, families: ['ELGT', 'ELGD', 'EGC', 'ESBF'], drives: ['spindle', 'belt'], supplies: ['ac230', 'ac400', 'dc48'], excludedMotorFamilies: [] }

const base: Requirements = { stroke: 500, velocity: 0.5, acceleration: 5, jerk: 0, payload: 10, cog: { x: 0, y: 0, z: 0 }, mounting: 'floor' }

/** these carry NaN on purpose (shown as —) */
const numeric = (c: Check) => c.label !== '설치 방향' && c.label !== '연결축 (KSK)'

function expectFinite(ev: AxisEvaluation, what: string) {
  for (const c of ev.checks.filter(numeric)) {
    expect(Number.isFinite(c.value), `${what}: ${c.label} value ${c.value}`).toBe(true)
    if (c.ratio != null) expect(Number.isFinite(c.ratio), `${what}: ${c.label} ratio ${c.ratio}`).toBe(true)
  }
  for (const s of ev.samples) {
    if (!Number.isFinite(s.torque) || !Number.isFinite(s.force)) throw new Error(`${what}: sample ${JSON.stringify(s)}`)
  }
  expect(ev.cycleTime, what).toBeGreaterThan(0)
  expect(Number.isFinite(ev.movingMass) && Number.isFinite(ev.inertia), what).toBe(true)
}

describe('motion profile boundaries', () => {
  const grid = {
    distance: [1e-6, 1e-4, 0.001, 0.05, 0.5, 8.5],
    v: [0.001, 0.1, 1, 10],
    a: [0.01, 1, 15, 100],
    jerk: [0, 0.01, 1, 100, 1e5, Infinity],
  }
  it('covers the distance, ends at rest and stays within the limits for any input', () => {
    for (const d of grid.distance)
      for (const v of grid.v)
        for (const a of grid.a)
          for (const j of grid.jerk) {
            const p = moveProfile(d, v, a, j)
            const what = `d=${d} v=${v} a=${a} j=${j}`
            const end = tracePhases(p.phases, 50).at(-1)!
            expect(Math.abs(end.x - d) / d, what).toBeLessThan(1e-6)
            expect(Math.abs(end.v), what).toBeLessThan(1e-9 + 1e-6 * p.peakVelocity)
            expect(p.peakVelocity, what).toBeLessThanOrEqual(v * (1 + 1e-12))
            expect(p.peakAcceleration, what).toBeLessThanOrEqual(a * (1 + 1e-12))
            expect(p.moveTime, what).toBeGreaterThan(0)
            // the samples' weights add up to the move time
            const dt = samplePhases(p.phases, () => 0).reduce((s, x) => s + x.dt, 0)
            expect(Math.abs(dt - p.moveTime) / p.moveTime, what).toBeLessThan(1e-9)
          }
  })

  it('rejects zero and negative inputs', () => {
    expect(() => moveProfile(0, 1, 1)).toThrow()
    expect(() => moveProfile(1, -1, 1)).toThrow()
    expect(() => moveProfile(1, 1, Number.NaN)).toThrow()
  })
})

describe('axis evaluation boundaries', () => {
  it('gives no result for inputs that are not positive', () => {
    const axis = axes[0]
    for (const bad of [0, -1, Number.NaN]) {
      expect(evaluateAxis(axis, { ...base, stroke: bad }, settings)).toBeNull()
      expect(evaluateAxis(axis, { ...base, velocity: bad }, settings)).toBeNull()
      expect(evaluateAxis(axis, { ...base, acceleration: bad }, settings)).toBeNull()
    }
  })

  const variants: [string, Partial<Requirements>, Partial<Settings>?][] = [
    ['tiny stroke', { stroke: 0.01 }],
    ['1 mm stroke with jerk', { stroke: 1, jerk: 50 }],
    ['stroke far beyond any axis', { stroke: 20000 }],
    ['no payload', { payload: 0 }],
    ['huge payload', { payload: 1e5 }],
    ['very slow', { velocity: 0.001, acceleration: 0.01 }],
    ['very fast', { velocity: 20, acceleration: 200, jerk: 1e4 }],
    ['far COG', { cog: { x: 2000, y: -2000, z: 2000 } }],
    ['negative COG', { cog: { x: -100, y: -100, z: -100 } }],
    ['wall', { mounting: 'wall', cog: { x: 50, y: 50, z: 50 } }],
    ['vertical', { mounting: 'vertical', cog: { x: 50, y: 50, z: 50 } }],
    ['vertical, no payload, dwell', { mounting: 'vertical', payload: 0 }, { dwellTime: 5 }],
    ['press over the whole stroke', { press: { ...defaultPress, enabled: true, distance: 500 } }],
    ['press longer than the stroke', { press: { ...defaultPress, enabled: true, distance: 5000 } }],
    ['press without force or hold', { press: { ...defaultPress, enabled: true, force: 0, holdTime: 0 } }],
    ['press faster than the travel', { press: { ...defaultPress, enabled: true, speed: 5 } }],
    ['press with zero distance (ignored)', { press: { ...defaultPress, enabled: true, distance: 0 } }],
    ['vertical press up', { mounting: 'vertical', press: { ...defaultPress, enabled: true, direction: 'up', force: 1e5 } }],
    ['vertical press down', { mounting: 'vertical', press: { ...defaultPress, enabled: true, direction: 'down', force: 1e5 } }],
    ['twin motor, payload on one axis', { cog: { x: 0, y: 150, z: 0 }, parallel: { ...defaultParallel, mode: 'twinMotor' } }],
    ['twin motor, payload outside the axes', { cog: { x: 0, y: 1000, z: 0 }, parallel: { ...defaultParallel, mode: 'twinMotor' } }],
    ['twin shaft', { parallel: { ...defaultParallel, mode: 'twinShaft', shaftInertia: 5 } }],
    ['twin, zero spacing (single)', { parallel: { ...defaultParallel, mode: 'twinMotor', spacing: 0 } }],
    ['six guide axes', { parallel: { ...defaultParallel, mode: 'guides', guideCount: 6 } }],
    ['guides count out of range', { parallel: { ...defaultParallel, mode: 'guides', guideCount: 99, guideAxis: false, guideMass: -5 } }],
    ['cross accelerations', { cross: { lateral: 20, normal: 20 } }],
    ['additional slides', {}, { additionalSlide: 'both', slidePitch: 1, slidePitchRight: 1e4 }],
    ['standard stroke, support, sensors', { stroke: 333.3 }, { standardStroke: true, spindleSupport: true, sensors: true }],
    ['zero efficiency settings stay finite', {}, { efficiency: { spindle: 1, belt: 1 }, friction: { spindle: 0, belt: 0 } }],
  ]

  for (const [name, req, set] of variants) {
    it(`every axis: ${name}`, () => {
      const s = { ...settings, ...set }
      for (const axis of axes) {
        const ev = evaluateAxis(axis, { ...base, ...req }, s, shafts, guides)
        if (!ev) continue
        expectFinite(ev, `${axis.id} (${name})`)
        // the profile never exceeds what was asked for
        expect(ev.peakVelocity).toBeLessThanOrEqual(Math.max(base.velocity, req.velocity ?? 0, req.press?.speed ?? 0) * (1 + 1e-9))
      }
    })
  }

  it('fails just above the max stroke and passes at it', () => {
    for (const axis of axes) {
      const at = evaluateAxis(axis, { ...base, stroke: axis.maxStroke, payload: 0.1, velocity: 0.01, acceleration: 0.1 }, settings)
      const above = evaluateAxis(axis, { ...base, stroke: axis.maxStroke + 1, payload: 0.1, velocity: 0.01, acceleration: 0.1 }, settings)
      expect(at?.checks.find((c) => c.label === '스트로크')?.status, axis.id).toBe('ok')
      expect(above?.checks.find((c) => c.label === '스트로크')?.status, axis.id).toBe('fail')
    }
  })

  it('grows with the payload: force, guide load and inertia', () => {
    for (const axis of axes) {
      for (const mounting of ['floor', 'wall', 'vertical'] as const) {
        const req = { ...base, mounting, cog: { x: 30, y: 30, z: 30 } }
        const light = evaluateAxis(axis, { ...req, payload: 5 }, settings)
        const heavy = evaluateAxis(axis, { ...req, payload: 50 }, settings)
        if (!light || !heavy) continue
        const fx = (e: AxisEvaluation) => e.checks.find((c) => c.label === '이송력 Fx')!.value
        expect(fx(heavy), axis.id).toBeGreaterThan(fx(light))
        expect(heavy.inertia, axis.id).toBeGreaterThan(light.inertia)
        if (!axis.rodLateralForceCurve) expect(heavy.guideFv, `${axis.id} ${mounting}`).toBeGreaterThan(light.guideFv)
      }
    }
  })

  it('the guide load covers the largest acceleration of the cycle (pressing: the return move)', () => {
    // jerk-limited: a 5 mm approach never reaches the set acceleration, the 500 mm return does
    const axis = axes.find((a) => a.id === 'ELGT-BS-120-…20P')!
    const req: Requirements = { ...base, jerk: 100, cog: { x: 0, y: 0, z: 200 }, press: { ...defaultPress, enabled: true, distance: 495, speed: 0.01 } }
    const ev = evaluateAxis(axis, req, settings)!
    expect(ev.backProfile.peakAcceleration).toBeCloseTo(5)
    expect(ev.profile.peakAcceleration).toBeLessThan(3)
    expect(ev.checks.find((c) => c.label === '가속도')!.value).toBeCloseTo(5)
    expect(ev.peakVelocity).toBeCloseTo(0.5)
    // My = (z + guide centre) · m · a at the return's acceleration
    expect(ev.guideFv).toBeCloseTo((ev.movingMass * 9.81) / axis.FzMax! + ((0.2 + axis.guideCentre! / 1000) * ev.movingMass * 5) / axis.MyMax!)
  })

  it('takes the moments about the centre of the guide where the data sheet refers to it (ELGT, ELGD), not on EGC', () => {
    const elgt = axes.find((a) => a.id === 'ELGT-BS-120-…20P')!
    expect(elgt.guideCentre).toBe(48) // ELGT-BS data sheet, dimension x
    const req: Requirements = { ...base, mounting: 'wall', cog: { x: 0, y: 0, z: 100 } }
    const l = guideLoads(req, 10, 5, elgt.guideCentre)
    expect(l.Mx).toBeCloseTo(0.148 * 10 * 9.81) // weight across the slide, lever z + x
    expect(l.My).toBeCloseTo(0.148 * 10 * 5)
    expect(l.Mz).toBe(0)
    // a COG behind the slide surface is nearer the guide
    expect(guideLoads({ ...req, cog: { x: 0, y: 0, z: -48 } }, 10, 5, 48).My).toBeCloseTo(0)
    for (const a of axes) {
      if (a.family === 'ESBF') expect(a.guideCentre, a.id).toBeUndefined()
      else expect(a.guideCentre, a.id).toBeGreaterThan(0)
    }
  })
})

describe('drive evaluation boundaries', () => {
  const picks = ['ELGT-BS-120-…20P', 'ELGD-TB-KF-WD-100-…-L'].map((id) => axes.find((a) => a.id === id)!)
  const reqs: Requirements[] = [
    { ...base, payload: 0 },
    { ...base, mounting: 'vertical', payload: 30, stroke: 1, jerk: 10 },
    { ...base, press: { ...defaultPress, enabled: true, force: 3000 } },
  ]

  it('every motor, direct and geared, gives finite checks', () => {
    for (const axis of picks)
      for (const req of reqs) {
        const ev = evaluateAxis(axis, req, { ...settings, dwellTime: 0.5 })!
        for (const motor of motors) {
          for (const g of [null, ...gearboxOptionsFor(motor)]) {
            const d = attachKit(ev, evaluateDrive(ev, motor, g, settings), kits, settings)
            const what = `${axis.id} + ${motor.id} + ${g?.id ?? 'direct'}`
            for (const c of [...d.checks, ...(d.kit?.checks ?? [])]) {
              expect(Number.isFinite(c.value), `${what}: ${c.label} ${c.value}`).toBe(true)
              if (c.ratio != null) expect(Number.isFinite(c.ratio), `${what}: ${c.label} ratio`).toBe(true)
            }
            expect(d.rmsTorque, what).toBeLessThanOrEqual(d.peakTorque + 1e-12)
            if (d.regenPower != null) expect(d.regenPower, what).toBeGreaterThanOrEqual(0)
          }
        }
      }
  })

  it('a gearbox divides the speed-side and multiplies the torque-side consistently', () => {
    const ev = evaluateAxis(picks[0], base, settings)!
    const motor = motors.find((m) => gearboxOptionsFor(m).length > 0)!
    const direct = evaluateDrive(ev, motor, null, settings)
    for (const g of gearboxOptionsFor(motor)) {
      const geared = evaluateDrive(ev, motor, g, settings)
      expect(geared.maxMotorSpeed).toBeCloseTo(direct.maxMotorSpeed * g.ratio, 6)
      // load inertia falls with i², the gearbox's own is added once
      expect(geared.inertiaRatio).toBeCloseTo((ev.inertia / g.ratio ** 2 + g.inertia + settings.couplingInertia) / motor.inertia, 9)
    }
    expect(gearboxes.length).toBeGreaterThan(0)
  })

  it('energy balance: on a frictionless horizontal axis the braking energy equals the accelerating energy', () => {
    const lossless: Settings = { ...settings, efficiency: { spindle: 1, belt: 1 }, friction: { spindle: 0, belt: 0 } }
    const axis = { ...picks[0], noLoadTorque: 0 }
    const ev = evaluateAxis(axis, { ...base, jerk: 80 }, lossless)!
    const motor = motors[0]
    let positive = 0
    let negative = 0
    for (const s of ev.samples) {
      const p = (s.torque + motor.inertia * 1e-4 * s.alpha) * s.omega * s.dt
      if (p > 0) positive += p
      else negative -= p
    }
    // two moves, each ½·m·v² + ½·J·ω²
    const omega = (ev.peakVelocity * 2 * Math.PI) / (ev.feed / 1000)
    const kinetic = 0.5 * (ev.inertia + motor.inertia) * 1e-4 * omega ** 2
    expect(positive).toBeCloseTo(2 * kinetic, 3)
    expect(negative).toBeCloseTo(2 * kinetic, 3)
  })
})
