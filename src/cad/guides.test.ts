import { describe, expect, it } from 'vitest'
import { evaluateAxis } from '../calc/axisSelection'
import { defaultParallel, defaultSettings, type Requirements } from '../calc/types'
import { axes, guides, kits, motors } from '../data'
import { evaluateDrive } from '../calc/motorSelection'
import { comboInputs } from '../ui/comboInputs'
import { buildCombo } from './combo'
import type { Drawing } from './drawings'

const texts = import.meta.glob<string>(['../../data/*/Festo/Drawings/**/*.stp'], { query: '?raw', import: 'default' })
const load = (d: Drawing) => texts[`../../${d.path}`]()

type OcctMesh = { name: string; attributes: { position: { array: number[] } } }
type Occt = { ReadStepFile: (data: Uint8Array, params: null) => { success: boolean; meshes: OcctMesh[] } }
const occt = import('occt-import-js').then((m) => (m.default as () => Promise<Occt>)())

async function boxes(step: string) {
  const result = (await occt).ReadStepFile(new TextEncoder().encode(step), null)
  expect(result.success).toBe(true)
  return result.meshes.map((m) => {
    const p = m.attributes.position.array
    const lo = [Infinity, Infinity, Infinity]
    const hi = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < p.length; i += 3)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[i + k])
        hi[k] = Math.max(hi[k], p[i + k])
      }
    return { name: m.name, lo, hi }
  })
}

const settings = { ...defaultSettings, families: ['ELGT', 'ELGD', 'EGC', 'ESBF'] as const, drives: ['spindle', 'belt'] as const }
const req: Requirements = { stroke: 300, velocity: 0.2, acceleration: 2, jerk: 0, payload: 5, cog: { x: 20, y: 0, z: 0 }, mounting: 'floor' }

/** the step-5 inputs of an axis with a motor and kit, as the app builds them */
function inputs(axisId: string, kitProduct: string, motorModel: string, r: Requirements, s = settings) {
  const axis = evaluateAxis(axes.find((a) => a.id === axisId)!, r, { ...s, families: [...s.families], drives: [...s.drives] }, [], guides)!
  const motor = motors.find((m) => m.model === motorModel)!
  const drive = evaluateDrive(axis, motor, null, { ...s, families: [...s.families], drives: [...s.drives] })!
  const kit = kits.find((k) => k.product === kitProduct && k.axisCode === axis.axis.interfaceCode)!
  return comboInputs(axis, drive, kit, r)
}

describe('guides in the combination drawing', () => {
  it('puts the EAGF on the ESBF front flange, the payload on its yoke plate', async () => {
    const { selection, found, twin, req: r } = inputs('ESBF-BS-32-…-5P', 'EAMM-A-D32-42A', 'EMMB-ST-42-S', { ...req, parallel: { ...defaultParallel, mode: 'guides' as const, guideAxis: true } }, settings)
    expect(selection!.guide?.model).toBe('EAGF-V2-KF-32-300')
    expect(found!.guide?.model).toBe('EAGF-V2-KF-32-400')
    const combo = await buildCombo(selection!, found!, r, load, undefined, twin)
    expect(combo.parts.map((p) => p.role)).toEqual(['axis', 'kit', 'motor', 'guide'])
    // floor: travel +X, the rod end at the origin; the yoke plate's front 69.5 mm ahead of the flange, the flange
    // 47.5 mm behind the rod end (ESBF-32), the payload COG 20 mm beyond the yoke
    expect(combo.cog[0]).toBeCloseTo(69.5 - 47.5 + 20, 1)
    const parts = await boxes(combo.step)
    const rods = parts.filter((p) => p.name.includes('(FST)'))
    expect(rods).toHaveLength(2)
    // the rods shortened by 100 mm with the stroke: from the yoke (57.7 − 47.5) back to 485.3 − 100 behind the flange
    for (const rod of rods) expect(rod.hi[0] - rod.lo[0]).toBeCloseTo(57.7 + 485.3 - 100, 0)
    // the guide rods one above the other (across x on the file's +x = world up)
    expect(Math.abs(rods[0].lo[2] - rods[1].lo[2])).toBeCloseTo(74, 0)
  }, 60000)

  it('places the guide axes beside the axis, slides level, lengthened to the stroke', async () => {
    const r = { ...req, stroke: 500, parallel: { ...defaultParallel, mode: 'guides' as const, spacing: 300, guideCount: 2, guideAxis: true } }
    const { selection, found, twin, req: cogReq } = inputs('ELGD-TB-KF-80', 'EAMM-A-L48-100A', 'EMMT-AS-100-H-HS', r)
    expect(selection!.guide).toMatchObject({ model: 'ELFD-KF-80-500-0H', offsets: [300, 600] })
    const combo = await buildCombo(selection!, found!, cogReq, load, undefined, twin)
    expect(combo.parts.filter((p) => p.role === 'guide')).toHaveLength(2)
    const parts = await boxes(combo.step)
    // the guide axes' parts: everything 200 mm or more over (+y on the floor)
    const guideParts = parts.filter((p) => p.lo[1] > 200)
    // the guides 300 and 600 mm over (+y on the floor), their tops level with the axis slide (z = 0)
    const ys = [...new Set(guideParts.map((p) => Math.round((p.lo[1] + p.hi[1]) / 2 / 100) * 100))].sort((a, b) => a - b)
    expect(ys).toEqual([300, 600])
    expect(Math.max(...guideParts.map((p) => p.hi[2]))).toBeCloseTo(0, 0)
    // lengthened from the 50 mm file: the profile spans the 500 mm stroke and more
    const profile = guideParts.reduce((a, b) => (b.hi[0] - b.lo[0] > a.hi[0] - a.lo[0] ? b : a))
    expect(profile.hi[0] - profile.lo[0]).toBeGreaterThan(500 + 150)
  }, 60000)

  it('runs the guide axis the same way as a ball screw EGC (whose file travels the other way)', async () => {
    const r = { ...req, stroke: 500, parallel: { ...defaultParallel, mode: 'guides' as const, spacing: 300, guideCount: 1, guideAxis: true } }
    const { selection, found, twin, req: cogReq } = inputs('EGC-80-...-BS-10P-KF-GK', 'EAMM-A-S48-60P-G3', 'EMMT-AS-60-M-HS', r)
    const parts = await boxes((await buildCombo(selection!, found!, cogReq, load, undefined, twin)).step)
    const longest = (list: typeof parts) => list.reduce((a, b) => (b.hi[0] - b.lo[0] > a.hi[0] - a.lo[0] ? b : a))
    const axis = longest(parts.filter((p) => p.hi[1] < 150))
    const guide = longest(parts.filter((p) => p.lo[1] > 150))
    expect(guide.lo[0]).toBeCloseTo(axis.lo[0], 0)
    expect(guide.hi[0]).toBeCloseTo(axis.hi[0], 0)
  }, 60000)
})
