import { describe, expect, it } from 'vitest'
import { adapterDrawingFor, bracketDrawingUrl, drawings, type AdapterMeta } from '../cad/drawings'
import { adapters, axes } from '../data'
import type { Axis } from '../data/types'
import { computeGantry, noPicks } from '../selection'
import { defaultGantry, type GantryInputs } from './gantry'
import { gantryJoint, jointAccessories, jointMass } from './gantryKits'
import { defaultSettings } from './types'

// Custom EGC brackets (data/adapters/Custom, cad/brackets/egc_brackets.py): X–Y angle brackets (mirror-image pairs
// -ML / -MR) and Y–Z adapter plates; Festo has no axis/axis kit for EGC
const egc = (size: number, drive: Axis['drive'] = 'belt', slide = 'GK') =>
  axes.find((a) => a.family === 'EGC' && !a.variant && a.size === size && a.drive === drive && a.slide === slide)!
const elgt = (size: number) => axes.find((x) => x.family === 'ELGT' && x.drive === 'spindle' && x.size === size)!
const brackets = adapters.filter((k) => k.custom && k.id.startsWith('BR-EGC-'))
const single: GantryInputs = {
  ...defaultGantry,
  config: 'xyz',
  yMounting: 'wall',
  parallel: { ...defaultGantry.parallel, x: { ...defaultGantry.parallel.x, mode: 'single' } },
}
const twinX = (spacing: number): GantryInputs => ({
  ...single,
  config: 'xy',
  parallel: { ...defaultGantry.parallel, x: { ...defaultGantry.parallel.x, mode: 'twinMotor', spacing } },
})
const open = { ...defaultSettings, families: ['ELGT', 'ELGD', 'EGC', 'ESBF'], drives: ['spindle', 'belt'], supplies: ['ac230', 'ac400', 'dc48'], excludedMotorFamilies: [] } satisfies typeof defaultSettings
const settings = { x: open, y: open, z: { ...open, requireBrake: true } }
const length = (a: Axis, stroke: number) => stroke + a.baseLength!

describe('custom EGC brackets', () => {
  it('lists an angle bracket pair and a plate for every base size with the same or one size smaller carried axis', () => {
    const pairs = [
      [70, 70],
      [70, 50],
      [80, 80],
      [80, 70],
      [120, 120],
      [120, 80],
      [185, 185],
      [185, 120],
    ]
    expect(brackets).toHaveLength(pairs.length * 3)
    for (const [b, c] of pairs) {
      const id = `BR-EGC-${b}-EGC-${c}`
      expect(brackets.filter((k) => k.joint === 'angle' && k.model.startsWith(`${id}-1-`)).map((k) => k.hand)).toEqual(['left', 'right'])
      expect(brackets.filter((k) => k.joint === 'plate' && k.model === `${id}-2`)).toHaveLength(1)
    }
    for (const k of brackets) {
      expect(k.partNumber).toBeNull()
      expect(k.maker).toBe('Custom')
      // one bracket for the belt and the ball screw axis of a size (same slide pattern and profile)
      expect(k.base.map((a) => a.drive).sort()).toEqual(['belt', 'spindle'])
      expect(k.carried.every((c) => c.end != null && !c.pinned)).toBe(true)
      expect(k.accessories.some((a) => /^(NST|ABAN)/.test(a.model) && a.quantity! > 0)).toBe(true)
      // drawing PDF, STEP and frames: the base frame on the slide pattern centre, the carried frame on the profile face
      expect(bracketDrawingUrl(k.drawing)).toBeTruthy()
      const meta = adapterDrawingFor(k, drawings)!.meta as AdapterMeta
      expect(meta.base.origin).toEqual([0, 0, 0])
      expect(meta.carried.axis).toEqual([1, 0, 0])
    }
  })

  it('reaches the -ML wall to the right seen facing the carried slide (n_base × n_carried), -MR its mirror image', () => {
    for (const ml of brackets.filter((k) => k.hand === 'left')) {
      const mr = brackets.find((k) => k.model === ml.model.replace(/-ML$/, '-MR'))!
      const a = adapterDrawingFor(ml, drawings)!.meta as AdapterMeta
      const b = adapterDrawingFor(mr, drawings)!.meta as AdapterMeta
      const cross = (u: number[], v: number[]) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
      const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
      const reach = (m: AdapterMeta) => m.carried.up.map((v) => v * dot(m.carried.origin, m.carried.up))
      expect(dot(reach(a), cross(a.base.axis, a.carried.axis))).toBeGreaterThan(0)
      expect(dot(reach(b), cross(b.base.axis, b.carried.axis))).toBeLessThan(0)
      expect(b.carried.origin).toEqual([a.carried.origin[0], -a.carried.origin[1], a.carried.origin[2]])
      expect(mr.mass).toBeCloseTo(ml.mass, 3)
    }
  })

  it('takes the angle bracket for EGC on EGC (X–Y), as no Festo kit fits', () => {
    const j = gantryJoint(single, 'x', 'y', egc(120), egc(120), 500, adapters, length(egc(120), 500))
    expect(j.kind).toBe('angle')
    expect(j.kit?.model).toBe('BR-EGC-120-EGC-120-1-ML')
    expect(j.kit?.custom).toBe(true)
    expect(j.status).toBe('ok')
    // clamped with slot nuts: the near end head behind the wall (end), the drive at +t as the calc takes it
    expect(j.aligned).toBe(true)
    expect(j.pinned).toBe(false)
    expect(j.flange).toBeNull()
    expect(j.driveSign).toBe(1)
    const end = j.kit!.carried.find((c) => c.drive === 'belt')!.end!
    expect(end).toBeLessThan(j.kit!.wall![0])
    // the bracket and its hardware in the load and the order list
    expect(jointMass(j)).toBeCloseTo(j.kit!.mass)
    expect(jointAccessories(j, adapters).map((x) => x.model)).toContain('NST-8-M6')
    // the ball screw axis takes the same bracket; GV slides (longer, the GK pattern in the middle) too
    expect(gantryJoint(single, 'x', 'y', egc(120, 'spindle'), egc(120, 'spindle'), 500, adapters).kit?.model).toBe('BR-EGC-120-EGC-120-1-ML')
    expect(gantryJoint(single, 'x', 'y', egc(120, 'belt', 'GV'), egc(120), 500, adapters).kit?.model).toBe('BR-EGC-120-EGC-120-1-ML')
  })

  it('takes one size down and finds nothing for a carried axis larger than the base axis', () => {
    expect(gantryJoint(single, 'x', 'y', egc(120), egc(80), 500, adapters).kit?.model).toBe('BR-EGC-120-EGC-80-1-ML')
    expect(gantryJoint(single, 'x', 'y', egc(70), egc(50), 300, adapters).kit?.model).toBe('BR-EGC-70-EGC-50-1-ML')
    const none = gantryJoint(single, 'x', 'y', egc(80), egc(120), 500, adapters)
    expect(none.kit).toBeNull()
    expect(none.status).toBe('warn')
    // two sizes down: not in the set either
    expect(gantryJoint(single, 'x', 'y', egc(185), egc(80), 500, adapters).kit).toBeNull()
  })

  it('never takes a custom bracket in place of a Festo kit', () => {
    const j = gantryJoint(single, 'x', 'y', elgt(160), elgt(120), 500, adapters, length(elgt(120), 500))
    expect(j.kit?.family).toBe('EHAM-AK')
    expect(j.kits.every((k) => !k.custom)).toBe(true)
  })

  it('hangs Z on the adapter plate (Y–Z), its upper head clear above the plate', () => {
    const [y, z] = [egc(120), egc(80, 'spindle')]
    const L = length(z, 300)
    const j = gantryJoint(single, 'y', 'z', y, z, 300, adapters, L)
    expect(j.kind).toBe('plate')
    expect(j.kit?.model).toBe('BR-EGC-120-EGC-80-2')
    expect(j.status).toBe('ok')
    const end = j.kit!.carried.find((c) => c.drive === 'spindle')!.end!
    // Z's near (upper) end at −end above the Y slide centre, its body below
    expect(j.offset.z).toBeCloseTo(-end - L / 2)
    // a Z stroke too short for the plate (its lower head would sit on it): warning
    const short = gantryJoint(single, 'y', 'z', y, z, 100, adapters, length(z, 100))
    expect(short.status).toBe('warn')
    expect(short.noteArgs).toMatchObject({ min: j.kit!.carriedStroke![0] })
  })

  it('mirrors the angle brackets under two X axes, the walls reaching inwards, the second clamping the Y profile anywhere', () => {
    const [x, y] = [egc(120), egc(120)]
    const L = length(y, 1200)
    const j = gantryJoint(twinX(1000), 'x', 'y', x, y, 1200, adapters, L)
    expect(j.kits.map((k) => k.model)).toEqual(['BR-EGC-120-EGC-120-1-MR', 'BR-EGC-120-EGC-120-1-ML'])
    expect(j.status).toBe('ok')
    expect(j.span!.spacing).toBeCloseTo(1000)
    expect(j.mountings).toBeUndefined()
    // walls reaching towards each other collide below twice their reach
    const clear = 2 * j.kit!.wall![1] + 2
    expect(j.span!.clear).toBeCloseTo(clear)
    const near = gantryJoint(twinX(clear - 50), 'x', 'y', x, y, 1200, adapters, L)
    expect(near.interference).toBe(true)
    expect(near.status).toBe('warn')
    // a Y axis too short to reach past the second bracket's slot nuts to behind its wall
    const far = gantryJoint(twinX(1500), 'x', 'y', x, y, 1200, adapters, L)
    expect(far.status).toBe('warn')
    expect(far.note).toContain('슬롯 너트')
    expect(far.span!.spacing).toBeLessThan(1500)
  })

  it('puts the bracket into the X axis load in the gantry (computeGantry, EGC X / Y / Z)', () => {
    const g: GantryInputs = { ...single, motion: { ...single.motion, y: { ...single.motion.y, stroke: 500 }, z: { ...single.motion.z, stroke: 200 } } }
    const picks = { x: { ...noPicks, axisId: egc(120).id }, y: { ...noPicks, axisId: egc(120).id }, z: { ...noPicks, axisId: egc(80, 'spindle').id } }
    const r = computeGantry(g, settings, picks)
    const [z, y, x] = r
    expect(x.joint?.kit?.model).toBe('BR-EGC-120-EGC-120-1-ML')
    expect(y.joint?.kit?.model).toBe('BR-EGC-120-EGC-80-2')
    expect(x.req!.payload).toBeCloseTo(y.stage!.mass + jointMass(x.joint!), 6)
    expect(y.req!.payload).toBeCloseTo(z.stage!.mass + jointMass(y.joint!), 6)
    expect(x.carried.some((c) => c.model?.includes('BR-EGC-120-EGC-120-1-ML'))).toBe(true)
  })
})
