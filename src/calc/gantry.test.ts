import { describe, expect, it } from 'vitest'
import { axes } from '../data'
import { computeGantry, noPicks } from '../selection'
import { evaluateAxis, G, guideLoads } from './axisSelection'
import { defaultGantry as appGantry, gantryRequirements, initialGantrySettings as appGantrySettings, slideFrame, stageOf, type GantryInputs } from './gantry'
import { jointMass } from './gantryKits'
import { defaultSettings as appDefaults, type Requirements } from './types'

// every axis and motor filter on (the app's defaults narrow the lists)
const defaultSettings = { ...appDefaults, families: ['ELGT', 'ELGD', 'EGC', 'ESBF'], drives: ['spindle', 'belt'], supplies: ['ac230', 'ac400', 'dc48'], excludedMotorFamilies: [] } satisfies typeof appDefaults

const baseReq: Requirements = {
  stroke: 500,
  velocity: 1,
  acceleration: 5,
  jerk: 0,
  payload: 10,
  cog: { x: 100, y: 50, z: 200 },
  mounting: 'floor',
}
const picks = { x: noPicks, y: noPicks, z: noPicks }
// the arrangement these tests were written for: Y on the floor, X with every drive (the app starts on a wall Y
// and a belt X)
const defaultGantry: GantryInputs = { ...appGantry, yMounting: 'floor' }
const initialGantrySettings = { ...appGantrySettings, x: { ...appGantrySettings.x, drives: ['spindle', 'belt'] } } satisfies typeof appGantrySettings
// every filter on, Z keeping its brake (the app's defaults leave no ball screw fast enough for the default X)
const openSettings = { x: defaultSettings, y: defaultSettings, z: { ...defaultSettings, requireBrake: true } }

describe('guideLoads with cross accelerations', () => {
  it('adds the lateral and normal inertial forces at the COG', () => {
    const base = guideLoads(baseReq, 10, 5)
    const l = guideLoads({ ...baseReq, cross: { lateral: 3, normal: 2 } }, 10, 5)
    // lateral 30 N at x 0.1, z 0.2; normal 20 N at x 0.1, y 0.05
    expect(l.Fy).toBeCloseTo(30)
    expect(l.Fz).toBeCloseTo(10 * G + 20)
    expect(l.Mx).toBeCloseTo(base.Mx + 0.2 * 30 + 0.05 * 20)
    expect(l.My).toBeCloseTo(base.My + 0.1 * 20)
    expect(l.Mz).toBeCloseTo(base.Mz + 0.1 * 30)
  })

  it('is unchanged without them', () => {
    expect(guideLoads({ ...baseReq, cross: { lateral: 0, normal: 0 } }, 10, 5)).toEqual(guideLoads(baseReq, 10, 5))
  })
})

describe('slideFrame', () => {
  it('has lateral = normal × travel', () => {
    expect(slideFrame('x', 'floor').l).toEqual([0, 1, 0])
    expect(slideFrame('y', 'floor').l).toEqual([-1, 0, 0])
    expect(slideFrame('z', 'vertical').l).toEqual([0, 1, 0])
  })
})

describe('gantryRequirements', () => {
  it('gives the tool axis the payload and the accelerations of the axes carrying it', () => {
    const req = gantryRequirements(defaultGantry, 'z', null, [])
    expect(req.mounting).toBe('vertical')
    expect(req.payload).toBe(defaultGantry.payload)
    // Z faces −X: X acceleration is normal to its slide, Y acceleration lateral
    expect(req.cross).toEqual({ lateral: defaultGantry.motion.y.acceleration, normal: defaultGantry.motion.x.acceleration })
    // input COG z +50 = world (0, 0, −50) from the slide: −50 along the travel
    expect(req.cog).toEqual({ x: -50, y: 0, z: 0 })
  })

  it('counts the payload COG X and Z the other way round (+X = away from the Z slide face, +Z = down)', () => {
    const cog = { x: 30, y: 20, z: 50 }
    // Z faces −X: +X input lies in front of the slide, +Z below it (−Z travel)
    expect(gantryRequirements({ ...defaultGantry, cog }, 'z', null, []).cog).toEqual({ x: -50, y: 20, z: 30 })
    // XY: the tool axis Y on the floor has lateral −X and normal +Z
    expect(gantryRequirements({ ...defaultGantry, config: 'xy', cog }, 'y', null, []).cog).toEqual({ x: 20, y: 30, z: -50 })
  })

  it('hands a selected axis with everything on it to the axis carrying it', () => {
    const z = gantryRequirements(defaultGantry, 'z', null, [])
    const axis = axes.find((a) => a.family === 'EGC' && a.drive === 'belt')!
    const evaluation = evaluateAxis(axis, z, defaultSettings)!
    const stage = stageOf('z', defaultGantry, evaluation, z, 2)
    expect(stage.mass).toBeCloseTo(evaluation.axisMass + 2 + z.payload)
    expect(stage.moving).toBeCloseTo(axis.slideMass + z.payload)
    const y = gantryRequirements(defaultGantry, 'y', stage, [stage])
    expect(y.payload).toBeCloseTo(stage.mass)
    // floor Y: X acceleration is lateral; the Z moving part's reaction is normal
    expect(y.cross!.lateral).toBeCloseTo(defaultGantry.motion.x.acceleration)
    expect(y.cross!.normal).toBeCloseTo((defaultGantry.motion.z.acceleration * stage.moving) / stage.mass)
  })
})

describe('moving profile', () => {
  const req: Requirements = { ...baseReq, mounting: 'vertical', stroke: 200, cog: { x: -30, y: 0, z: 0 }, movingProfile: { driveMass: 3 } }

  it('moves the profile and the drive instead of the slide', () => {
    const axis = axes.find((a) => a.family === 'ELGD' && a.drive === 'spindle')!
    const slide = evaluateAxis(axis, { ...req, movingProfile: undefined }, defaultSettings)!
    const profile = evaluateAxis(axis, req, defaultSettings)!
    expect(profile.movingMass).toBeCloseTo(req.payload + profile.axisMass - axis.slideMass + 3)
    expect(profile.movingMass).toBeGreaterThan(slide.movingMass)
  })

  it('leaves out electric cylinders', () => {
    const esbf = axes.find((a) => a.family === 'ESBF')!
    expect(evaluateAxis(esbf, req, defaultSettings)).toBeNull()
  })
})

describe('computeGantry', () => {
  it('selects every axis of an XYZ gantry from the tool down', () => {
    const results = computeGantry(defaultGantry, openSettings, picks)
    expect(results.map((r) => r.axis)).toEqual(['z', 'y', 'x'])
    for (const r of results) expect(r.sel?.selectedAxis).toBeTruthy()
    const [z, y, x] = results
    // each axis carries more than the one before it, and the gantry kits joining it to the axis it carries
    const kitMass = (r: typeof x) => (r.joint?.kit ? jointMass(r.joint) : 0)
    expect(y.req!.payload).toBeCloseTo(z.stage!.mass + kitMass(y))
    expect(x.req!.payload).toBeCloseTo(y.stage!.mass + kitMass(x))
    expect(x.req!.payload).toBeGreaterThan(y.req!.payload)
    expect(x.req!.parallel?.mode).toBe('twinMotor')
  })

  it('sets the X spacing to fit the angle kits under two X axes (no overlap, the Y axis on the second kit profile mountings)', () => {
    const elgt = (size: number) => axes.find((x) => x.family === 'ELGT' && x.drive === 'spindle' && x.size === size)!.id
    const g: GantryInputs = { ...defaultGantry, config: 'xy', yMounting: 'wall', parallel: { ...defaultGantry.parallel, x: { ...defaultGantry.parallel.x, mode: 'twinMotor', spacing: 600 } } }
    const chosen = { ...picks, x: { ...noPicks, axisId: elgt(160) }, y: { ...noPicks, axisId: elgt(120) } }
    const [, x] = computeGantry(g, initialGantrySettings, chosen)
    const j = x.joint!
    expect(j.kit?.family).toBe('EHAM-AK')
    // 600 mm: the walls (375 mm ahead of each foot) would overlap; the spacing used clears them
    expect(x.spacing?.entered).toBe(600)
    expect(x.spacing!.used).toBeGreaterThanOrEqual(j.span!.clear)
    expect(x.req!.parallel!.spacing).toBe(x.spacing!.used)
    expect(j.interference).toBe(false)
    expect(j.span!.mismatch).toBeCloseTo(0)
    expect(j.status).toBe('ok')
  })

  it('takes the parallel arrangement on the base axis: Y in yz, X otherwise', () => {
    const twinY = { ...defaultGantry.parallel.y, mode: 'twinMotor' as const, spacing: 400 }
    const g: GantryInputs = { ...defaultGantry, config: 'yz', yMounting: 'wall', parallel: { ...defaultGantry.parallel, y: twinY } }
    const elgt = (size: number) => axes.find((x) => x.family === 'ELGT' && x.drive === 'spindle' && x.size === size)!.id
    const chosen = { ...picks, y: { ...noPicks, axisId: elgt(120) }, z: { ...noPicks, axisId: elgt(90) } }
    const [z, y] = computeGantry(g, initialGantrySettings, chosen)
    expect(y.req!.parallel?.mode).toBe('twinMotor')
    expect(z.req!.parallel).toBeUndefined()
    // Z on two Y slides: one kit per slide
    expect(y.joint!.kit?.family).toBe('EHAM-MA')
    expect(y.joint!.kits).toHaveLength(2)
    // in xyz the Y arrangement is not used
    const [, yx] = computeGantry({ ...g, config: 'xyz' }, initialGantrySettings, chosen)
    expect(yx.req!.parallel).toBeUndefined()
  })

  it('runs a moving Z profile with its selected drive', () => {
    const g: GantryInputs = { ...defaultGantry, config: 'yz', zMode: 'profile' }
    const [z, y] = computeGantry(g, initialGantrySettings, picks)
    expect(z.req!.movingProfile!.driveMass).toBeCloseTo(z.drive!.mass)
    expect(y.req!.payload).toBeCloseTo(z.stage!.mass)
  })
})
