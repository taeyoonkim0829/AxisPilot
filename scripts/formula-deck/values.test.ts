// What the app's calculation returns for the formula deck's worked example, for build.py to check its numbers against.
// Runs only when asked (it is no test):
//   AXISPILOT_DECK=tmp/formula-deck npx vitest run scripts/formula-deck/values.test.ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { it } from 'vitest'
import { defaultSettings, type Requirements, type Settings } from '../../src/calc/types'
import { computeSelection, noPicks } from '../../src/selection'

const out = process.env.AXISPILOT_DECK

const base: Requirements = { stroke: 500, velocity: 0.5, acceleration: 2, jerk: 0, payload: 15, cog: { x: 50, y: 30, z: 80 }, mounting: 'floor' }
const settings: Settings = { ...defaultSettings, dwellTime: 0.5, families: ['ELGT'], drives: ['spindle'], makers: ['Festo'] }
const AXIS = 'ELGT-BS-90-…20P'
const select = (req: Requirements, motorId = 'EMMT-AS-60-S-HS') => computeSelection(req, settings, { ...noPicks, axisId: AXIS, motorId })

function example() {
  const s = select(base)
  const a = s.selectedAxis!
  const ax = a.axis
  const d = s.selectedDrive!
  const m = d.motor
  const k = d.kit!
  // one sample per segment and direction: the torque is constant along each without jerk
  const samples = new Map<string, unknown>()
  for (const x of a.samples) samples.set(`${x.dir}|${x.torque.toFixed(4)}`, { a: x.a, dir: x.dir, force: x.force, torque: x.torque })
  return {
    axis: { order: a.order, feed: a.feed, inertia: a.inertia, movingMass: a.movingMass, axisMass: a.axisMass, cycle: a.cycleTime, fv: a.guideFv, T0: a.noLoadTorque, J0: ax.inertiaJ0, JH: ax.inertiaJHPerMeter, JL: ax.inertiaJLPerKg, slideMass: ax.slideMass, Fz: ax.FzMax, Mx: ax.MxMax, My: ax.MyMax, Mz: ax.MzMax, xg: ax.guideCentre ?? 0, Iy: ax.Iy, base: ax.baseLength, Ca: ax.screwDynamicLoadRating, Fx: ax.maxFeedForce, vmax: ax.maxSpeed },
    profile: { accelTime: a.profile.accelTime, accelDistance: a.profile.accelDistance, moveTime: a.profile.moveTime },
    checks: a.checks,
    info: a.info,
    samples: [...samples.values()],
    motor: { id: m.id, inertia: m.inertia, rated: m.ratedTorque, peak: m.peakTorque, ratedSpeed: m.ratedSpeed, kt: m.torqueConstant, allow: m.allowableInertiaRatio, pn: m.partNumber },
    drive: { peak: d.peakTorque, rms: d.rmsTorque, speed: d.maxMotorSpeed, ratio: d.inertiaRatio, checks: d.checks },
    kit: { product: k.kit.product, part: k.kit.partNumber, T: k.kit.transmissibleTorque, N: k.kit.maxSpeed, J: k.kit.inertia, checks: k.checks },
    controller: d.controller,
  }
}

function whatIf() {
  const cases: [string, Requirements][] = [
    ['m25', { ...base, payload: 25 }],
    ['s1000', { ...base, stroke: 1000 }],
    ['x200z200', { ...base, cog: { x: 200, y: 30, z: 200 } }],
    ['vertical', { ...base, mounting: 'vertical' }],
  ]
  return cases.map(([name, req]) => {
    const s = select(req)
    const a = s.selectedAxis!
    const d = s.selectedDrive
    const all = [...a.checks, ...(d?.checks ?? []), ...(d?.kit?.checks ?? []), ...(d?.controller?.checks ?? [])]
    return { name, fv: a.guideFv, ratio: d?.inertiaRatio, bad: all.filter((c) => c.status !== 'ok').map((c) => [c.label, c.value, c.limit, c.status]) }
  })
}

function nextMotor() {
  const d = select({ ...base, payload: 25 }, 'EMMT-AS-60-M-HS').selectedDrive!
  return { motor: d.motor.id, status: d.status, ratio: d.inertiaRatio }
}

it.skipIf(!out)('formula deck values', () => {
  mkdirSync(out!, { recursive: true })
  writeFileSync(join(out!, 'values.json'), JSON.stringify({ example: example(), whatIf: whatIf(), nextMotor: nextMotor() }, null, 1))
})
