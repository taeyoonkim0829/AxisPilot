import { describe, expect, it } from 'vitest'
import { accelerationForTime, accelTimeFor, minAccelTime, moveProfile, phaseState, samplePhases, sCurveShare, tracePhases } from './motionProfile'

function integrate(distance: number, v: number, a: number, j: number) {
  const p = moveProfile(distance, v, a, j)
  const samples = samplePhases(p.phases, () => 0, 20000)
  return { p, travelled: samples.reduce((s, x) => s + x.v * x.dt, 0), samples }
}

describe('moveProfile', () => {
  it('trapezoid matches the Excel formulas', () => {
    const p = moveProfile(0.5, 0.5, 5)
    expect(p.accelTime).toBeCloseTo(0.1)
    expect(p.accelDistance).toBeCloseTo(0.025)
    expect(p.constantTime).toBeCloseTo(0.9)
    expect(p.moveTime).toBeCloseTo(1.1)
    expect(p.reachedVelocity).toBe(true)
  })

  it('falls back to a triangular profile on short strokes', () => {
    const p = moveProfile(0.01, 1, 1)
    expect(p.reachedVelocity).toBe(false)
    expect(p.peakVelocity).toBeCloseTo(0.1, 6)
    expect(p.moveTime).toBeCloseTo(0.2, 6)
  })

  it('jerk-limited profile covers the stroke and lengthens the move', () => {
    const { p, travelled, samples } = integrate(0.5, 0.5, 5, 100)
    expect(travelled).toBeCloseTo(0.5, 4)
    expect(p.moveTime).toBeGreaterThan(moveProfile(0.5, 0.5, 5).moveTime)
    expect(Math.max(...samples.map((s) => s.a))).toBeCloseTo(5)
    const last = p.phases.at(-1)!
    expect(phaseState(last, last.duration).v).toBeCloseTo(0, 9)
  })

  it('caps acceleration when jerk is too low to reach it', () => {
    const { p, travelled } = integrate(1, 0.5, 5, 10)
    expect(p.peakAcceleration).toBeCloseTo(Math.sqrt(0.5 * 10))
    expect(travelled).toBeCloseTo(1, 4)
  })

  it('handles jerk-limited short strokes', () => {
    const { p, travelled } = integrate(0.005, 1, 10, 200)
    expect(p.reachedVelocity).toBe(false)
    expect(travelled).toBeCloseTo(0.005, 5)
  })

  it('trace position ends at the stroke, in either direction', () => {
    for (const [j, dir] of [[0, 1], [200, -1]] as const) {
      const trace = tracePhases(moveProfile(0.5, 1, 10, j, dir).phases)
      expect(trace.at(-1)!.x).toBeCloseTo(0.5 * dir, 9)
      expect(trace.at(-1)!.v).toBeCloseTo(0, 9)
    }
  })
})

describe('accelerationForTime', () => {
  it('gives the S-curve share of the acceleration time', () => {
    expect(sCurveShare(1, 5, 0)).toBe(0)
    expect(sCurveShare(1, 5, 50)).toBeCloseTo(2 / 3) // 2 × 0.1 s ramps of 0.3 s
    expect(sCurveShare(1, 5, 10)).toBe(1) // jerk too low to reach 5 m/s²
  })

  it('inverts accelTimeFor with and without jerk', () => {
    expect(accelerationForTime(0.5, 0.1)).toBeCloseTo(5)
    const a = accelerationForTime(1, 0.3, 50)
    expect(accelTimeFor(1, a, 50)).toBeCloseTo(0.3)
    expect(moveProfile(1, 1, a, 50).accelTime).toBeCloseTo(0.3)
  })

  it('falls back to the triangular profile below the minimum time', () => {
    expect(minAccelTime(1, 100)).toBeCloseTo(0.2)
    expect(accelTimeFor(1, accelerationForTime(1, 0.1, 100), 100)).toBeCloseTo(0.2)
  })
})
