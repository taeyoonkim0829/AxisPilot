// Point-to-point motion profile: trapezoidal (jerk = 0/∞) or symmetric jerk-limited S-curve.
// SI units throughout (m, s).

/** A span of the profile in which acceleration changes linearly from a0 to a1. */
export interface Phase {
  duration: number
  a0: number
  a1: number
  v0: number
  /** +1 / -1 travel direction while moving, 0 while dwelling; a press hold is +1 at standstill */
  dir: 1 | -1 | 0
  /** N, process force against the forward direction during this phase (pressing) */
  load?: number
}

export interface MoveProfile {
  /** Cruise velocity actually reached (may be below the requested one on short strokes) */
  peakVelocity: number
  /** Acceleration actually reached (below the requested one when jerk limits it) */
  peakAcceleration: number
  /** Duration of the acceleration phase, jerk ramps included */
  accelTime: number
  accelDistance: number
  constantTime: number
  moveTime: number
  reachedVelocity: boolean
  phases: Phase[]
}

interface AccelShape {
  jerkTime: number
  constAccelTime: number
  peakAccel: number
  time: number
  distance: number
}

function accelShape(v: number, aMax: number, jerk: number): AccelShape {
  if (!(jerk > 0) || !Number.isFinite(jerk)) {
    const time = v / aMax
    return { jerkTime: 0, constAccelTime: time, peakAccel: aMax, time, distance: (v * time) / 2 }
  }
  if (v * jerk < aMax * aMax) {
    // aMax is never reached: triangular acceleration
    const jerkTime = Math.sqrt(v / jerk)
    const time = 2 * jerkTime
    return { jerkTime, constAccelTime: 0, peakAccel: jerk * jerkTime, time, distance: (v * time) / 2 }
  }
  const jerkTime = aMax / jerk
  const constAccelTime = v / aMax - jerkTime
  const time = 2 * jerkTime + constAccelTime
  return { jerkTime, constAccelTime, peakAccel: aMax, time, distance: (v * time) / 2 }
}

/** Time to reach v from standstill with acceleration aMax and jerk (0 = unlimited) [s]. */
export function accelTimeFor(v: number, aMax: number, jerk = 0): number {
  return accelShape(v, aMax, jerk).time
}

/** Share of the acceleration time spent in the jerk ramps: 0 = trapezoidal, 1 = pure S-curve (no constant-acceleration part). */
export function sCurveShare(v: number, aMax: number, jerk = 0): number {
  const { jerkTime, time } = accelShape(v, aMax, jerk)
  return time > 0 ? (2 * jerkTime) / time : 0
}

/** Shortest possible acceleration time to v: 0 without a jerk limit, else the triangular profile 2·√(v/j) [s]. */
export function minAccelTime(v: number, jerk = 0): number {
  return jerk > 0 && Number.isFinite(jerk) ? 2 * Math.sqrt(v / jerk) : 0
}

/**
 * Acceleration that reaches v in time t (inverse of `accelTimeFor`). With jerk, t = v/a + a/j, taking the
 * root with a ≤ √(v·j); below `minAccelTime` the triangular profile's peak √(v·j) is returned.
 */
export function accelerationForTime(v: number, t: number, jerk = 0): number {
  if (!(jerk > 0) || !Number.isFinite(jerk)) return v / t
  const disc = jerk * jerk * t * t - 4 * jerk * v
  return disc <= 0 ? Math.sqrt(v * jerk) : (jerk * t - Math.sqrt(disc)) / 2
}

/**
 * @param distance travel [m]
 * @param vMax requested velocity [m/s]
 * @param aMax requested acceleration (= deceleration) [m/s²]
 * @param jerk [m/s³]; 0 or non-finite means unlimited (trapezoidal profile)
 * @param dir travel direction
 */
export function moveProfile(distance: number, vMax: number, aMax: number, jerk = 0, dir: 1 | -1 = 1): MoveProfile {
  if (!(distance > 0 && vMax > 0 && aMax > 0)) throw new Error('distance, vMax and aMax must be positive')

  let v = vMax
  let shape = accelShape(v, aMax, jerk)
  const reachedVelocity = 2 * shape.distance <= distance
  if (!reachedVelocity) {
    // Short stroke: find the cruise velocity whose accel + decel distance equals the stroke.
    let lo = 0
    let hi = vMax
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2
      if (2 * accelShape(mid, aMax, jerk).distance > distance) hi = mid
      else lo = mid
    }
    v = lo
    shape = accelShape(v, aMax, jerk)
  }

  const constantTime = Math.max(0, (distance - 2 * shape.distance) / v)
  const { jerkTime: tj, constAccelTime: ta, peakAccel: ap } = shape
  const vAfterJerk = (ap * tj) / 2

  const raw: Omit<Phase, 'dir'>[] = [
    { duration: tj, a0: 0, a1: ap, v0: 0 },
    { duration: ta, a0: ap, a1: ap, v0: vAfterJerk },
    { duration: tj, a0: ap, a1: 0, v0: v - vAfterJerk },
    { duration: constantTime, a0: 0, a1: 0, v0: v },
    { duration: tj, a0: 0, a1: -ap, v0: v },
    { duration: ta, a0: -ap, a1: -ap, v0: v - vAfterJerk },
    { duration: tj, a0: -ap, a1: 0, v0: vAfterJerk },
  ]
  const phases = raw
    .filter((p) => p.duration > 1e-12)
    .map((p) => ({ duration: p.duration, a0: p.a0 * dir, a1: p.a1 * dir, v0: p.v0 * dir, dir }))

  return {
    peakVelocity: v,
    peakAcceleration: ap,
    accelTime: shape.time,
    accelDistance: shape.distance,
    constantTime,
    moveTime: 2 * shape.time + constantTime,
    reachedVelocity,
    phases,
  }
}

export function dwellPhase(duration: number): Phase {
  return { duration, a0: 0, a1: 0, v0: 0, dir: 0 }
}

/** Velocity and acceleration at time t inside a phase. */
export function phaseState(p: Phase, t: number): { v: number; a: number } {
  const k = p.duration > 0 ? (p.a1 - p.a0) / p.duration : 0
  return { a: p.a0 + k * t, v: p.v0 + p.a0 * t + (k * t * t) / 2 }
}

export interface TracePoint {
  /** s */
  t: number
  /** m, from the start of the trace */
  x: number
  v: number
  a: number
  /** m/s³ */
  j: number
  dir: 1 | -1 | 0
  /** N, `Phase.load` */
  load: number
}

/** Evenly spaced time trace of phases, for plotting. Each phase contributes both end points, so steps stay vertical. */
export function tracePhases(phases: Phase[], points = 400): TracePoint[] {
  const total = phases.reduce((s, p) => s + p.duration, 0)
  const trace: TracePoint[] = []
  let start = 0
  let x0 = 0
  for (const p of phases) {
    const n = Math.max(2, Math.ceil((p.duration / total) * points))
    const j = p.duration > 0 ? (p.a1 - p.a0) / p.duration : 0
    const xAt = (t: number) => x0 + p.v0 * t + (p.a0 * t * t) / 2 + (j * t * t * t) / 6
    for (let k = 0; k <= n; k++) {
      const t = (p.duration * k) / n
      trace.push({ t: start + t, x: xAt(t), ...phaseState(p, t), j, dir: p.dir, load: p.load ?? 0 })
    }
    start += p.duration
    x0 = xAt(p.duration)
  }
  return trace
}

export interface Sample {
  v: number
  a: number
  dir: 1 | -1 | 0
  /** Integration weight [s]; 0 for samples only used for peak detection */
  dt: number
  /** Index of the move the sample belongs to (-1 while dwelling) */
  move: number
  /** N, `Phase.load` */
  load: number
}

/**
 * Discretises phases for integration (midpoint rule) and adds phase boundary
 * points with zero weight so peaks are always captured exactly.
 */
export function samplePhases(phases: Phase[], moveIndex: (phaseIndex: number) => number, resolution = 1000): Sample[] {
  const total = phases.reduce((s, p) => s + p.duration, 0)
  const samples: Sample[] = []
  phases.forEach((p, i) => {
    const move = moveIndex(i)
    const n = Math.max(4, Math.ceil((p.duration / total) * resolution))
    const dt = p.duration / n
    const load = p.load ?? 0
    for (const t of [0, p.duration]) samples.push({ ...phaseState(p, t), dir: p.dir, dt: 0, move, load })
    for (let k = 0; k < n; k++) samples.push({ ...phaseState(p, (k + 0.5) * dt), dir: p.dir, dt, move, load })
  })
  return samples
}
