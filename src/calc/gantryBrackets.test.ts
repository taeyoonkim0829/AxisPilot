import { describe, expect, it } from 'vitest'
import { adapterDrawingFor, drawings, type BeamMeta } from '../cad/drawings'
import { adapters, axes } from '../data'
import type { Axis } from '../data/types'
import { computeGantry, noPicks } from '../selection'
import { axisFrame, defaultGantry, type GantryInputs } from './gantry'
import { beamBrackets, beamHardware, gantryJoint, jointMass, wantsBeam } from './gantryKits'
import { defaultSettings } from './types'

// Custom cross beams (data/adapters/Custom) between a pair of EHAM-AK-L9 angle kits on two ELGT-BS base axes: Z beams
// (the Z axis on an EHAM-MA plate on the pad) and Y beams (the Y axis pinned on the front face)
const elgt = (size: number, pitch = 10) => axes.find((x) => x.family === 'ELGT' && x.drive === 'spindle' && x.size === size && x.model.includes(`${pitch}P`))!
const custom = adapters.filter((k) => k.custom)
const twinX = (spacing: number): GantryInputs => ({
  ...defaultGantry,
  config: 'xy',
  yMounting: 'wall',
  parallel: { ...defaultGantry.parallel, x: { ...defaultGantry.parallel.x, mode: 'twinMotor', spacing } },
})
const twinY = (spacing: number): GantryInputs => ({
  ...defaultGantry,
  config: 'yz',
  yMounting: 'floor',
  parallel: { ...defaultGantry.parallel, y: { ...defaultGantry.parallel.y, mode: 'twinMotor', spacing } },
})
// every axis and motor filter on (the app's defaults narrow the lists)
const open = { ...defaultSettings, families: ['ELGT', 'ELGD', 'EGC', 'ESBF'], drives: ['spindle', 'belt'], supplies: ['ac230', 'ac400', 'dc48'], excludedMotorFamilies: [] } satisfies typeof defaultSettings
const settings = { x: open, y: open, z: { ...open, requireBrake: true } }

describe('custom brackets', () => {
  it('lists one Z beam per ELGT-BS base size, for the Z the EHAM-MA plate on its pad takes', () => {
    const pairs: [number, number][] = [
      [90, 90],
      [120, 90],
      [160, 120],
    ]
    for (const [x, z] of pairs) {
      const found = beamBrackets(elgt(x), elgt(z), adapters)
      expect(found.map((k) => k.model)).toEqual([`BR-ELGT-BS-${x}-ELGT-BS-${z}-1`])
      expect(found[0].partNumber).toBeNull()
    }
    expect(beamBrackets(elgt(160), elgt(90), adapters)).toEqual([])
  })

  it('keeps the Festo kits while the Y axis reaches the second kit', () => {
    for (const [x, y] of [
      [90, 90],
      [120, 120],
      [160, 160],
    ] as const) {
      const j = gantryJoint(twinX(1000), 'x', 'y', elgt(x), elgt(y), 500, adapters)
      expect(j.kits.length).toBe(2)
      for (const k of j.kits) expect(k.custom).toBeFalsy()
      expect(j.beam).toBeUndefined()
    }
    // X120 / Y120 716 mm: the second kit fits at 752 or 852 mm, within one thread pitch of 800
    const near = gantryJoint(twinX(800), 'x', 'y', elgt(120), elgt(120), 500, adapters, 716)
    expect(near.beam).toBeUndefined()
    expect(near.span!.spacing).toBeCloseTo(752)
  })

  it('takes a beam only when the fitting spacing is more than a thread pitch off, or none', () => {
    const span = { mismatch: 0, spacing: 900, clear: 698 }
    expect(wantsBeam(span, 950, 100)).toBe(false)
    expect(wantsBeam(span, 1000, 100)).toBe(false)
    expect(wantsBeam(span, 1001, 100)).toBe(true)
    expect(wantsBeam({ ...span, spacing: null }, 1000, 100)).toBe(true)
    // the kits' walls collide below `clear`: no beam fits either
    expect(wantsBeam({ ...span, spacing: null }, 650, 100)).toBe(false)
  })

  it('puts a Y beam between the kits when the X axes are too far apart for the Y axis', () => {
    // Y ELGT-BS-120-300: 516 mm long, reaches the second kit at 752 mm at most; X spacing 1500 kept
    const j = gantryJoint(twinX(1500), 'x', 'y', elgt(120), elgt(120), 300, adapters, 516)
    expect(j.kind).toBe('beam')
    expect(j.beam!.bracket.model).toBe('BR-ELGT-BS-120-ELGT-BS-120-2')
    expect(j.beam!.length).toBeCloseTo(1500 - 2 * 44.5)
    expect(j.span).toBeUndefined()
    expect(j.status).toBe('ok')
    // the kits of the beam (same size both sides), mirrored and reaching inwards: the first X axis (−Y) takes MR
    expect(j.kits.map((k) => k.model)).toEqual(['EHAM-AK-L9-120-L9-120-MR', 'EHAM-AK-L9-120-L9-120-ML'])
    // the Y axis centred on the beam, drive towards +Y; the mounting point along Y as entered
    expect(j.offset.y).toBeCloseTo(0)
    expect(j.flange).toBeCloseTo(258)
    expect(j.driveSign).toBe(1)
    // kits, beam at its length; hardware: screws, washers, pins
    expect(jointMass(j)).toBeCloseTo(2 * 5.313 + 9.68 * 1.411, 3)
    expect(beamHardware(j, adapters).map((x) => x.model)).toEqual(['ISO 4762 M6x16-8.8', 'ISO 7092-6 200HV', 'ISO 8734 6x16'])
  })

  it('carries Y on the beam for every X size the kits pair with', () => {
    for (const [x, y] of [
      [90, 90],
      [120, 90],
      [120, 120],
      [160, 120],
      [160, 160],
    ] as const) {
      const j = gantryJoint(twinX(1600), 'x', 'y', elgt(x), elgt(y), 100, adapters, 100 + elgt(y).baseLength!)
      expect(j.beam?.bracket.model).toBe(`BR-ELGT-BS-${x}-ELGT-BS-${y}-2`)
      expect(j.status).toBe('ok')
    }
  })

  it('warns when the beam is longer than its stiffness limit or the Y fixing holes reach behind a kit wall', () => {
    const long = gantryJoint(twinX(3000), 'x', 'y', elgt(120), elgt(120), 300, adapters, 516)
    expect(long.beam).toBeDefined()
    expect(long.status).toBe('warn')
    expect(long.noteArgs).toMatchObject({ length: 3000 - 89, max: 2000 })
    // a long Y pushed to one side: its far fixing holes behind the second kit's wall
    const g = { ...twinX(1300), offsets: { ...defaultGantry.offsets, xy: { x: 0, y: 300, z: 0 } } }
    const side = gantryJoint(g, 'x', 'y', elgt(120), elgt(120), 300, adapters, 516)
    expect(side.beam).toBeDefined()
    expect(side.status).toBe('warn')
  })

  it('hangs Z on a beam across two floor-mounted Y axes (yz), facing across the beam', () => {
    const g = twinY(1000)
    expect(axisFrame(g, 'z').n).toEqual([0, -1, 0])
    const j = gantryJoint(g, 'y', 'z', elgt(90), elgt(90), 200, adapters, 430)
    expect(j.kind).toBe('beam')
    expect(j.beam!.bracket.model).toBe('BR-ELGT-BS-90-ELGT-BS-90-1')
    expect(j.beam!.plate!.model).toBe('EHAM-MA-L9-120-L9-90')
    expect(j.beam!.length).toBeCloseTo(1000 - 21)
    // Z by its top drive end 181.5 mm above the pad centre (102 mm above the Y slides)
    expect(j.flange).toBeCloseTo(102 + 181.5)
    expect(j.offset.z).toBeCloseTo(102 + 181.5 - 430 / 2)
    expect(j.status).toBe('ok')
    // short Z strokes take the type C plate
    expect(gantryJoint(g, 'y', 'z', elgt(90), elgt(90), 100, adapters, 330).beam!.plate!.model).toBe('EHAM-MA-L9-120-L9-90-S')
  })

  it('keeps the null joint for Z on a single floor-mounted Y', () => {
    const g: GantryInputs = { ...twinY(1000), parallel: { ...defaultGantry.parallel, y: { ...defaultGantry.parallel.y, mode: 'single' } } }
    const j = gantryJoint(g, 'y', 'z', elgt(90), elgt(90), 200, adapters, 430)
    expect(j.kind).toBeNull()
    expect(j.status).toBe('warn')
  })

  it('recommends the Z beam for twin floor Y axes in the gantry (yz, ELGT-BS-90 ×2, Z ELGT-BS-90-200)', () => {
    const g: GantryInputs = {
      ...twinY(1000),
      motion: { ...defaultGantry.motion, y: { ...defaultGantry.motion.y, stroke: 500 }, z: { ...defaultGantry.motion.z, stroke: 200 } },
    }
    const picks = { x: noPicks, y: { ...noPicks, axisId: elgt(90, 20).id }, z: { ...noPicks, axisId: elgt(90, 20).id } }
    const r = computeGantry(g, settings, picks)
    const y = r.find((a) => a.axis === 'y')!
    expect(y.sel?.selectedAxis?.order.model).toBe('ELGT-BS-90-500-20P')
    expect(y.joint).not.toBeNull()
    expect(y.joint!.kind).toBe('beam')
    expect(y.joint!.beam!.bracket.model).toBe('BR-ELGT-BS-90-ELGT-BS-90-1')
    // the entered spacing kept; the beam, kits and plate in the Y axes' load
    expect(y.spacing).toBeUndefined()
    expect(y.carried.map((c) => c.label)).toContain('크로스 빔 (주문 제작)')
    const z = r.find((a) => a.axis === 'z')!
    expect(y.req!.payload).toBeCloseTo(z.stage!.mass + jointMass(y.joint!), 6)
  })

  it('keeps the entered X spacing with a Y beam in the gantry (xy)', () => {
    const g: GantryInputs = { ...twinX(1500), motion: { ...defaultGantry.motion, y: { ...defaultGantry.motion.y, stroke: 300 } } }
    const picks = { x: { ...noPicks, axisId: elgt(120, 20).id }, y: { ...noPicks, axisId: elgt(120, 20).id }, z: noPicks }
    const r = computeGantry(g, settings, picks)
    const x = r.find((a) => a.axis === 'x')!
    expect(x.joint!.beam!.length).toBeCloseTo(1411)
    expect(x.spacing).toBeUndefined()
    expect(x.req!.parallel!.spacing).toBe(1500)
    const y = r.find((a) => a.axis === 'y')!
    expect(x.req!.payload).toBeCloseTo(y.stage!.mass + jointMass(x.joint!), 6)
  })

  it('sits between the Festo kits it names: their carried end, part numbers and frames', () => {
    expect(custom.length).toBe(8)
    for (const b of custom) {
      const [ml, mr] = b.beam!.kits.map((m) => adapters.find((k) => k.model === m)!)
      expect([ml.hand, mr.hand]).toEqual(['left', 'right'])
      const fit = ml.carried.find((c) => c.size === b.base[0].size)!
      expect(fit.end).toBe(b.beam!.end)
      // the base spacing range: the kits' walls clear of each other at the shortest beam (2 mm), as gantryJoint's `clear`
      expect(b.beam!.length[0] + 2 * b.beam!.end).toBeCloseTo(2 * ml.wall![1] + 2)
      for (const k of [ml, mr]) expect(b.accessories.some((a) => a.partNumber === k.partNumber && a.quantity === 1)).toBe(true)
      // the frames on the beam's own model: kit side on the profile centreline (the kit's carried frame), the Z pad
      // (EHAM-MA base frame) in the middle of the reference length, the Y drive flange where the Y stroke puts it
      const own = adapterDrawingFor(b, drawings)!
      expect(own.model).toBe(b.model)
      const kitMeta = adapterDrawingFor(ml, drawings)!.meta!
      const meta = own.meta as BeamMeta
      expect(meta.length).toBe(b.beam!.referenceLength)
      // beam bottom 22 mm above the base slide surface (kit foot top at 20)
      expect(meta.base.origin[2] + 22).toBeCloseTo(kitMeta.carried.origin[1])
      expect(meta.baseB.origin[0]).toBe(meta.length)
      if (b.beam!.carries === 'z') {
        expect(meta.carried.origin[0]).toBe(meta.length / 2)
        expect(meta.carried.origin[2] + 22).toBe(b.beam!.padHeight)
      } else {
        const y = elgt(b.carried[0].size)
        expect(meta.carried.origin[0]).toBeCloseTo(meta.length / 2 + (meta.yStroke! + y.baseLength!) / 2)
        expect(meta.carried.origin[2]).toBe(meta.base.origin[2])
      }
      // the carried axis's holes lie between the kit hole patterns at both ends
      expect(meta.window[0]).toBeGreaterThan(300)
      expect(meta.window[1]).toBeLessThan(meta.length - 300)
      expect(b.mass).toBeCloseTo(b.beam!.massPerMeter * (meta.length / 1000), 1)
    }
  })

  it('carries the Z axis like the EHAM-MA plate it names', () => {
    for (const b of custom.filter((k) => k.beam!.carries === 'z')) {
      const plate = adapters.find((k) => k.family === 'EHAM-MA' && b.accessories[2].model === k.model)!
      expect(b.carried).toEqual(plate.carried)
      const z: Axis = elgt(b.carried[0].size)
      expect(beamBrackets(elgt(b.base[0].size), z, adapters)).toContain(b)
    }
  })
})
