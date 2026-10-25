import { describe, expect, it } from 'vitest'
import { defaultGantry as appGantry, type GantryAxis, type GantryInputs } from '../calc/gantry'
import { gantryJoint } from '../calc/gantryKits'
import { adapters, axes, kits, motors } from '../data'
import type { Axis, AxisAdapter } from '../data/types'
import { buildCombo, comboDrawings, defaultComboOptions, type ComboSelection } from './combo'
import { parseDrawingPath, type AdapterMeta, type BeamMeta, type Drawing } from './drawings'
import { beamAtLength, beamTooShort, buildGantry, type GantryAxisDrawing } from './gantry'
import { writeStep } from './step'

// loaded on demand: the drawing folders hold gigabytes of STEP text; Custom: the custom brackets
const texts = import.meta.glob<string>('../../data/*/{Festo,Custom}/Drawings/**/*.stp', { query: '?raw', import: 'default' })
const metas = import.meta.glob<unknown>('../../data/*/{Festo,Custom}/Drawings/**/*.json', { import: 'default', eager: true })
const all: Drawing[] = Object.keys(texts).map((key) => {
  const path = key.slice('../../'.length)
  return { ...parseDrawingPath(path)!, url: path, meta: metas[key.replace(/\.stp$/, '.json')] ?? null }
})
const load = (d: Drawing) => texts[`../../${d.path}`]()
// the arrangement these tests were written for: Y on the floor (the app starts on a wall Y)
const defaultGantry: GantryInputs = { ...appGantry, yMounting: 'floor' }

type OcctMesh = { name: string; attributes: { position: { array: number[] } } }
type Occt = { ReadStepFile: (data: Uint8Array, params: null) => { success: boolean; meshes: OcctMesh[] } }
const occt = import('occt-import-js').then((m) => (m.default as () => Promise<Occt>)())

/** bounding box of each mesh whose name matches */
async function boxes(step: string, re: RegExp) {
  const result = (await occt).ReadStepFile(new TextEncoder().encode(step), null)
  expect(result.success).toBe(true)
  return result.meshes
    .filter((m) => re.test(m.name))
    .map((m) => {
      const lo = [Infinity, Infinity, Infinity]
      const hi = [-Infinity, -Infinity, -Infinity]
      const p = m.attributes.position.array
      for (let i = 0; i < p.length; i += 3)
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], p[i + k])
          hi[k] = Math.max(hi[k], p[i + k])
        }
      return { name: m.name, lo, hi }
    })
}

/** an axis of the data with the first motor and kit that have drawings */
function axisDrawing(a: GantryAxis, axis: Axis, stroke: number, g: GantryInputs): GantryAxisDrawing {
  for (const kit of kits.filter((k) => k.axisCode === axis.interfaceCode && k.type === 'axial' && !k.special))
    for (const motor of motors.filter((m) => m.maker === 'Festo' && m.interfaceCode === kit.motorCode)) {
      const sel: ComboSelection = { axis, axisModel: `${axis.model}-${stroke}`, stroke, motor, gearbox: null, kit }
      const found = comboDrawings(sel, all)
      if (found.missing.length === 0)
        return {
          axis: a,
          sel,
          found,
          req: { mounting: a === 'z' ? 'vertical' : a === 'y' ? g.yMounting : g.xMounting, cog: { x: 0, y: 0, z: 50 } },
          options: defaultComboOptions,
        }
    }
  throw new Error(`no drawings for ${axis.model}`)
}

const kitDrawing = (k: AxisAdapter) =>
  (all.find((d) => d.kind === 'adapters' && (k.partNumber ? d.partNumber === k.partNumber : d.names.includes(k.model))) as Drawing<AdapterMeta>) ?? null
const jointDrawing = (j: ReturnType<typeof gantryJoint>) => ({
  base: j.base,
  carried: j.carried,
  kits: j.kits.map((kit) => ({ kit, drawing: kitDrawing(kit) })),
  offset: j.offset,
  flange: j.flange,
  driveSign: j.driveSign,
  beam: j.beam && {
    bracket: j.beam.bracket,
    drawing: kitDrawing(j.beam.bracket) as Drawing<BeamMeta> | null,
    length: j.beam.length,
    at: j.beam.at,
    plate: j.beam.plate && { kit: j.beam.plate, drawing: kitDrawing(j.beam.plate) },
  },
})
/** world Y of the pins matching `re` (box centres, mm rounded to 0.5) */
async function pinsAt(step: string, re: RegExp) {
  return (await boxes(step, re)).map((b) => Math.round((b.lo[1] + b.hi[1])) / 2).sort((p, q) => p - q)
}

describe('gantry kits', () => {
  const find = (family: string, size: number, drive: Axis['drive'], longSlide = false, variant = '') =>
    axes.find((x) => x.family === family && x.size === size && x.drive === drive && x.longSlide === longSlide && (x.variant || '') === variant)!
  const wallY: GantryInputs = { ...defaultGantry, yMounting: 'wall' }

  it('picks the adapter plate by the Z stroke (type C up to 100 mm on ELGT-120/90, else type B)', () => {
    const [y, z] = [find('ELGT', 120, 'spindle'), find('ELGT', 90, 'spindle')]
    expect(gantryJoint(wallY, 'y', 'z', y, z, 100, adapters).kit?.model).toBe('EHAM-MA-L9-120-L9-90-S')
    expect(gantryJoint(wallY, 'y', 'z', y, z, 300, adapters).kit?.model).toBe('EHAM-MA-L9-120-L9-90')
    const long = gantryJoint(wallY, 'y', 'z', y, z, 600, adapters)
    expect(long.status).toBe('warn')
    expect(long.noteArgs?.max).toBe(500)
  })

  it('needs the long slide on the ELGD base axis and two kits under two X axes', () => {
    const y = find('ELGD', 80, 'belt')
    const short = gantryJoint(wallY, 'x', 'y', find('ELGD', 80, 'belt'), y, 500, adapters)
    expect(short.kit?.model).toBe('EHAM-AK-E24-80-E24-80-MR-S')
    expect(short.status).toBe('warn')
    const ok = gantryJoint(wallY, 'x', 'y', find('ELGD', 80, 'belt', true), y, 500, adapters)
    expect(ok.status).toBe('ok')
    expect(ok.quantity).toBe(2)
    // mirror images, both walls reaching inwards: the first X axis (−Y) takes MR, reaching to +Y
    expect(ok.kits.map((k) => k.model)).toEqual(['EHAM-AK-E24-80-E24-80-MR-S', 'EHAM-AK-E24-80-E24-80-ML-S'])
  })

  it('clamps the ELGD on the second angle kit with its profile mountings, at any spacing it reaches', () => {
    const [x, y] = [find('ELGD', 80, 'belt', true), find('ELGD', 80, 'belt')]
    const twin = (spacing: number) => ({ ...wallY, parallel: { ...wallY.parallel, x: { ...wallY.parallel.x, mode: 'twinMotor' as const, spacing } } })
    // an 800 mm Y: its near end 34.5 mm from the first foot, the slot (less the 70 mm belt head) covers the second
    // console's EAHF-E24-60-P-B4 (66 … 146 mm back from its foot) up to 34.5 + 800 − 70 + 66 = 830.5 mm
    const fit = gantryJoint(twin(600), 'x', 'y', x, y, 500, adapters, 800)
    expect(fit.status).toBe('ok')
    expect(fit.span!.spacing).toBeCloseTo(600)
    // the B4 come with the kits (accessories), nothing on top
    expect(fit.mountings).toBeUndefined()
    const far = gantryJoint(twin(900), 'x', 'y', x, y, 500, adapters, 800)
    expect(far.status).toBe('warn')
    expect(far.span!.spacing).toBeCloseTo(830.5)
    // the walls (162 mm ahead of each foot) clear from 326 mm
    expect(gantryJoint(twin(300), 'x', 'y', x, y, 500, adapters, 800).span).toMatchObject({ clear: 326, spacing: 326 })
  })

  it('takes the angle kit hand whose wall reaches towards the carried axis', () => {
    const [x, y] = [find('ELGT', 160, 'spindle'), find('ELGT', 120, 'spindle')]
    const single = { ...wallY, parallel: { ...wallY.parallel, x: { ...wallY.parallel.x, mode: 'single' as const } } }
    const at = (dy: number) => gantryJoint({ ...single, offsets: { ...single.offsets, xy: { x: 0, y: dy, z: 0 } } }, 'x', 'y', x, y, 500, adapters).kit?.model
    // seen facing the Y slide (from −X), ML reaches to the right (−Y), MR to the left (+Y)
    expect(at(300)).toBe('EHAM-AK-L9-160-L9-120-MR')
    expect(at(-300)).toBe('EHAM-AK-L9-160-L9-120-ML')
    expect(at(0)).toBe('EHAM-AK-L9-160-L9-120-ML')
  })

  it('pins the carried axis at its drive end on the angle kit (pin and threaded holes of the profile)', () => {
    const [x, y] = [find('ELGT', 160, 'spindle'), find('ELGT', 120, 'spindle')]
    const g = { ...wallY, parallel: { ...wallY.parallel, x: { ...wallY.parallel.x, mode: 'single' as const } }, offsets: { ...wallY.offsets, xy: { x: 0, y: 300, z: 0 } } }
    const j = gantryJoint(g, 'x', 'y', x, y, 500, adapters, 500 + y.baseLength!)
    // MR reaches to +Y; the kit's pins hold the Y drive flange 71.5 mm from the foot, the body beyond it, so the
    // drive is at the −Y end
    expect(j.aligned && j.pinned).toBe(true)
    expect(j.flange).toBeCloseTo(71.5)
    expect(j.offset.y).toBeCloseTo(71.5 + (500 + 216) / 2)
    expect(j.driveSign).toBe(-1)
    expect(j.kitAt).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('clamps the pinned carried axis on the second kit under two X axes with profile mountings, at any spacing it reaches', () => {
    const [x, y] = [find('ELGT', 160, 'spindle'), find('ELGT', 120, 'spindle')]
    const twin = (spacing: number) => ({ ...wallY, parallel: { ...wallY.parallel, x: { ...wallY.parallel.x, mode: 'twinMotor' as const, spacing } } })
    const festo = adapters.filter((k) => !k.custom)
    // first X at −450 (MR, reaching +Y); the mirrored kit's EAHF reach 126.5 … 333.5 mm back from its foot, and the
    // 716 mm Y slot (less the 11.5 mm end cap) covers them all up to 71.5 + 716 − 11.5 + 126.5 = 902.5 mm
    const fit = gantryJoint(twin(900), 'x', 'y', x, y, 500, festo, 716)
    expect(fit.flange).toBeCloseTo(-450 + 71.5)
    expect(fit.status).toBe('ok')
    expect(fit.span!.spacing).toBeCloseTo(900)
    expect(fit.span!.mismatch).toBeCloseTo(0)
    expect(fit.mountings).toMatchObject({ model: 'EAHF-L2-45-P', quantity: 6 })
    expect(fit.mountings!.mass).toBeCloseTo(0.21)
    // farther apart: the Y axis does not reach them all; without a beam the spacing that fits is suggested
    const far = gantryJoint(twin(1000), 'x', 'y', x, y, 500, festo, 716)
    expect(far.span!.spacing).toBeCloseTo(902.5)
    expect(far.status).toBe('warn')
    // with the custom beams in the data, the beam takes its place at the entered spacing
    expect(gantryJoint(twin(1000), 'x', 'y', x, y, 500, adapters, 716).kind).toBe('beam')
  })

  it('finds the two mirrored angle kits overlapping when the X axes are close', () => {
    const [x, y] = [find('ELGT', 160, 'spindle'), find('ELGT', 120, 'spindle')]
    const close = gantryJoint({ ...wallY, parallel: { ...wallY.parallel, x: { ...wallY.parallel.x, mode: 'twinMotor', spacing: 600 } } }, 'x', 'y', x, y, 500, adapters, 716)
    // the walls reach 375 mm from each foot: they clear from 752 mm, the nearest fitting spacing
    expect(close.interference).toBe(true)
    expect(close.span!.clear).toBe(752)
    expect(close.span!.spacing).toBe(752)
    expect(close.status).toBe('warn')
    // a Y axis too short to reach the second kit at any clear spacing
    const short = gantryJoint({ ...wallY, parallel: { ...wallY.parallel, x: { ...wallY.parallel.x, mode: 'twinMotor', spacing: 600 } } }, 'x', 'y', x, y, 100, adapters, 316)
    expect(short.span!.spacing).toBeNull()
    expect(short.status).toBe('warn')
  })

  it('hangs Z on the adapter plate by its drive end, above the Y slide centre', () => {
    const [y, z] = [find('ELGT', 120, 'spindle'), find('ELGT', 90, 'spindle')]
    const j = gantryJoint(wallY, 'y', 'z', y, z, 300, adapters, 300 + z.baseLength!)
    expect(j.pinned).toBe(true)
    expect(j.flange).toBeCloseTo(181.5)
    expect(j.driveSign).toBe(1)
    expect(j.offset.z).toBeCloseTo(181.5 - (300 + 230) / 2)
  })

  it('has no kit for Z on a floor-mounted Y', () => {
    const j = gantryJoint(defaultGantry, 'y', 'z', find('ELGT', 120, 'spindle'), find('ELGT', 90, 'spindle'), 300, adapters)
    expect(j.kind).toBeNull()
    expect(j.status).toBe('warn')
  })
})

describe('gantry drawing', () => {
  it('builds a long twin X axis (more entity ids than a call takes as arguments)', async () => {
    // ELGT lengthened by whole hole pitches: 3000 mm takes the file past 100 000 entities
    const x = axes.find((a) => a.family === 'ELGT' && a.drive === 'spindle' && a.size === 160)!
    const d = axisDrawing('x', x, 3000, defaultGantry)
    const combo = await buildCombo(d.sel, d.found, { mounting: 'floor', cog: { x: 0, y: 0, z: 0 } }, load, defaultComboOptions, {
      spacing: 600,
      drive: true,
    })
    expect(combo.parts.filter((p) => p.role === 'axis')).toHaveLength(2)
  }, 120000)

  it('stands Y on the X slide with an angle kit and hangs Z on the Y slide with an adapter plate (ELGT)', async () => {
    const g: GantryInputs = { ...defaultGantry, yMounting: 'wall', parallel: { ...defaultGantry.parallel, x: { ...defaultGantry.parallel.x, mode: 'single' } } }
    const elgt = (size: number) => axes.find((x) => x.family === 'ELGT' && x.drive === 'spindle' && x.size === size)!
    const [x, y, z] = [elgt(160), elgt(120), elgt(90)]
    const parts = [axisDrawing('x', x, 1000, g), axisDrawing('y', y, 500, g), axisDrawing('z', z, 300, g)]
    const xy = gantryJoint(g, 'x', 'y', x, y, 500, adapters, parts[1].sel.stroke + y.baseLength!)
    const yz = gantryJoint(g, 'y', 'z', y, z, 300, adapters, parts[2].sel.stroke + z.baseLength!)
    expect(xy.kit?.model).toBe('EHAM-AK-L9-160-L9-120-ML')
    expect(yz.kit?.model).toBe('EHAM-MA-L9-120-L9-90')
    const combo = await buildGantry(g, parts, [jointDrawing(xy), jointDrawing(yz)], load)
    expect(combo.unkitted).toEqual([])
    const found = await boxes(combo.step, /EHAM|ELGT-BS/)
    const kitXY = found.find((b) => /EHAM-AK/.test(b.name))!
    const kitYZ = found.find((b) => /EHAM-MA/.test(b.name))!
    // the angle kit stands on the X slide (top at z = 0), the plate on the Y slide (facing −X)
    expect(kitXY.lo[2]).toBeCloseTo(0, 0)
    expect(kitYZ.lo[0]).toBeLessThan(0)
  }, 120000)

  it('puts the angle kit pins into the Y profile pin holes in the drawing', async () => {
    const g: GantryInputs = {
      ...defaultGantry,
      config: 'xy',
      yMounting: 'wall',
      parallel: { ...defaultGantry.parallel, x: { ...defaultGantry.parallel.x, mode: 'single' } },
      offsets: { ...defaultGantry.offsets, xy: { x: 0, y: 300, z: 0 } },
    }
    const elgt = (size: number) => axes.find((x) => x.family === 'ELGT' && x.drive === 'spindle' && x.size === size)!
    const [x, y] = [elgt(160), elgt(120)]
    const yd = axisDrawing('y', y, 500, g)
    const xy = gantryJoint(g, 'x', 'y', x, y, 500, adapters, yd.sel.stroke + y.baseLength!)
    const combo = await buildGantry(g, [axisDrawing('x', x, 800, g), yd], [jointDrawing(xy)], load)
    // MR, drive at −Y: flange at 71.5, the profile end 31.5 beyond it, its pin bores 100 and 200 mm in
    expect(await pinsAt(combo.step, /6H7x14/)).toEqual([203, 303])
  }, 120000)

  it('mirrors the angle kits under two X axes, both walls reaching inwards', async () => {
    // Y 1000 + 216 mm long, pinned at the first kit, clamped on the second kit's profile mountings
    const g: GantryInputs = { ...defaultGantry, config: 'xy', yMounting: 'wall', parallel: { ...defaultGantry.parallel, x: { ...defaultGantry.parallel.x, mode: 'twinMotor', spacing: 1006 } } }
    const elgt = (size: number) => axes.find((x) => x.family === 'ELGT' && x.drive === 'spindle' && x.size === size)!
    const [x, y] = [elgt(160), elgt(120)]
    const yd = axisDrawing('y', y, 1000, g)
    const xy = gantryJoint(g, 'x', 'y', x, y, 1000, adapters, yd.sel.stroke + y.baseLength!)
    expect(xy.span!.mismatch).toBeCloseTo(0)
    const combo = await buildGantry(g, [{ ...axisDrawing('x', x, 800, g), twin: { spacing: 1006, drive: true } }, yd], [jointDrawing(xy)], load)
    const found = (await boxes(combo.step, /EHAM-AK/)).filter((b) => /EHAM-AK/.test(b.name))
    // the first kit's pins in the Y pin bores (foot at −503)
    expect((await pinsAt(combo.step, /6H7x14/)).filter((p) => p < 0)).toEqual([-503 + 203, -503 + 303])
    expect(found.map((b) => b.name.replace(/^\d+ /, '').replace(/---.*$/, '')).sort()).toEqual(['EHAM-AK-L9-160-L9-120-ML', 'EHAM-AK-L9-160-L9-120-MR'])
    // each wall (470 mm, foot at one end over its X axis at ∓503) lies mostly between the X axes
    for (const b of found) expect(Math.abs((b.lo[1] + b.hi[1]) / 2)).toBeLessThan(450)
  }, 120000)
})

describe('custom cross beams in the gantry drawing', () => {
  const elgt = (size: number) => axes.find((x) => x.family === 'ELGT' && x.drive === 'spindle' && x.size === size)!
  const box = (b: { lo: number[]; hi: number[] }, k: number) => b.hi[k] - b.lo[k]

  it('cuts the carried axis holes out and changes the beam length in the middle, the kit patterns kept', async () => {
    const beams = adapters.filter((k) => k.custom && k.joint === 'beam')
    expect(beams.length).toBe(8)
    for (const bracket of beams) {
      const d = kitDrawing(bracket) as Drawing<BeamMeta>
      const text = await load(d)
      for (const length of [bracket.beam!.length[0], 1234, bracket.beam!.length[1]]) {
        const [b] = await boxes(writeStep(beamAtLength(text, bracket, d.meta!, length)), /BR-/)
        expect(box(b, 0)).toBeCloseTo(length, 0)
        expect(box(b, 1)).toBeCloseTo(80, 0)
      }
    }
  }, 120000)

  it('bolts a Y beam between the kits of two X axes and pins the Y axis on its front (xy)', async () => {
    const g: GantryInputs = { ...defaultGantry, config: 'xy', yMounting: 'wall', parallel: { ...defaultGantry.parallel, x: { ...defaultGantry.parallel.x, mode: 'twinMotor', spacing: 1500 } } }
    const [x, y] = [elgt(120), elgt(120)]
    const yd = axisDrawing('y', y, 300, g)
    const j = gantryJoint(g, 'x', 'y', x, y, 300, adapters, 300 + y.baseLength!)
    expect(j.beam?.bracket.model).toBe('BR-ELGT-BS-120-ELGT-BS-120-2')
    const combo = await buildGantry(g, [{ ...axisDrawing('x', x, 800, g), twin: { spacing: 1500, drive: true } }, yd], [jointDrawing(j)], load)
    expect(combo.unkitted).toEqual([])
    const found = await boxes(combo.step, /BR-|EHAM|ELGT-BS-120-300/)
    const beam = found.find((b) => /BR-/.test(b.name))!
    // L = 1500 − 2 × 44.5 along Y, centred; 22 mm above the X slides; its back on the kit walls (−19), front at −99
    expect(box(beam, 1)).toBeCloseTo(1411, 0)
    expect(beam.lo[1] + beam.hi[1]).toBeCloseTo(0, 0)
    expect(beam.lo[2]).toBeCloseTo(22, 0)
    expect(beam.lo[0]).toBeCloseTo(-99, 0)
    for (const k of found.filter((b) => /EHAM-AK/.test(b.name))) expect(k.hi[0]).toBeGreaterThan(beam.hi[0])
    // the Y profile's underside on the beam front, its drive flange at +258 (Y centred)
    const profile = found.find((b) => /ELGT-BS-120-300--/.test(b.name))!
    expect(profile.hi[0]).toBeCloseTo(-99, 0)
    expect(profile.lo[1]).toBeCloseTo(-258, 0)
  }, 120000)

  it('hangs Z on a beam across two floor-mounted Y axes (yz, ELGT-BS-90, Z on EHAM-MA)', async () => {
    const g: GantryInputs = { ...defaultGantry, config: 'yz', yMounting: 'floor', parallel: { ...defaultGantry.parallel, y: { ...defaultGantry.parallel.y, mode: 'twinMotor', spacing: 1000 } } }
    const [y, z] = [elgt(90), elgt(90)]
    const zd = axisDrawing('z', z, 200, g)
    const j = gantryJoint(g, 'y', 'z', y, z, 200, adapters, 200 + z.baseLength!)
    const combo = await buildGantry(g, [{ ...axisDrawing('y', y, 500, g), twin: { spacing: 1000, drive: true } }, zd], [jointDrawing(j)], load)
    expect(combo.unkitted).toEqual([])
    const found = await boxes(combo.step, /BR-|EHAM|ELGT-BS-90-200/)
    const beam = found.find((b) => /BR-/.test(b.name))!
    const plate = found.find((b) => /EHAM-MA/.test(b.name))!
    // the beam across X between the Y axes (979 mm), its front facing −Y; the plate on it in the middle
    expect(box(beam, 0)).toBeCloseTo(979, 0)
    expect(beam.lo[1]).toBeCloseTo(-79, 0)
    expect(plate.hi[1]).toBeCloseTo(beam.lo[1], 0)
    expect(plate.lo[0] + plate.hi[0]).toBeCloseTo(0, 0)
    // the Z profile on the plate, its top drive end 102 + 181.5 mm above the Y slides
    const profile = found.find((b) => /ELGT-BS-90-200--/.test(b.name))!
    expect(profile.hi[1]).toBeCloseTo(plate.lo[1], 0)
    expect(profile.hi[2]).toBeGreaterThan(102 + 181.5 - 1)
  }, 120000)

  it('leaves a beam out of the drawing, with a warning, when the base spacing is too short for it', async () => {
    // Y spacing 400: L = 400 − 21 = 379 < 609
    const g: GantryInputs = { ...defaultGantry, config: 'yz', yMounting: 'floor', parallel: { ...defaultGantry.parallel, y: { ...defaultGantry.parallel.y, mode: 'twinMotor', spacing: 400 } } }
    const [y, z] = [elgt(90), elgt(90)]
    const j = gantryJoint(g, 'y', 'z', y, z, 200, adapters, 200 + z.baseLength!)
    expect(j.beam && beamTooShort(j.beam)).toBe(true)
    expect(j.status).toBe('warn')
    expect(j.noteArgs).toMatchObject({ spacing: 400, length: 379, need: 630 })
    const combo = await buildGantry(g, [{ ...axisDrawing('y', y, 500, g), twin: { spacing: 400, drive: true } }, axisDrawing('z', z, 200, g)], [jointDrawing(j)], load)
    expect(combo.unkitted).toEqual(['Y–Z'])
    expect((await boxes(combo.step, /BR-/)).filter((b) => /BR-/.test(b.name))).toEqual([])
  }, 120000)
})
