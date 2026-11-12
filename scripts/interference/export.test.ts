// Exports gantry drawings for the interference check (scripts/interference/gantry.py), built exactly as the app's
// 조합축 도면 does: the axes, motors and kits the app selects for each scenario, the gantry kits from the joints.
// Runs only when asked (it is no test):
//   AXISPILOT_EXPORT=tmp/interference npx vitest run scripts/interference/export.test.ts
// Writes <scenario>.step and <scenario>.json (each top-level part in order: name, role, the axis it belongs to or
// the base axis of its gantry kit; each axis's world travel `t` and ordered stroke; zMode; `ySlide`: where the drawing has
// the Y slide, `GantryCombo.y`).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'vitest'
import { axisCog } from '../../src/calc/axisSelection'
import { axisFrame, defaultGantry, initialGantrySettings, type GantryAxis, type GantryInputs, type GantrySettings } from '../../src/calc/gantry'
import type { AxisFamily } from '../../src/data/types'
import { comboDrawings, defaultComboOptions, DRIVE_POSITIONS, type ComboOptions, type ComboSelection } from '../../src/cad/combo'
import { adapterDrawingFor, mountingDrawingFor, parseDrawingPath, shaftDrawingFor, type BeamMeta, type Drawing } from '../../src/cad/drawings'
import { buildGantry, type GantryAxisDrawing, type GantryJointDrawing } from '../../src/cad/gantry'
import { apply, rotate } from '../../src/cad/geometry'
import { stretchedOrigin } from '../../src/cad/stretch'
import { computeGantry, noPicks } from '../../src/selection'

const out = process.env.AXISPILOT_EXPORT
const only = process.env.AXISPILOT_SCENARIO

const texts = import.meta.glob<string>('../../data/*/*/Drawings/**/*.{stp,STP}', { query: '?raw', import: 'default' })
const metas = import.meta.glob<unknown>('../../data/*/*/Drawings/**/*.json', { import: 'default', eager: true })
const all: Drawing[] = Object.keys(texts).flatMap((key) => {
  const path = key.slice('../../'.length)
  const parsed = parseDrawingPath(path)
  return parsed ? [{ ...parsed, url: path, meta: metas[key.replace(/\.(stp|STP)$/, '.json')] ?? null }] : []
})
const load = (d: Drawing) => texts[`../../${d.path}`]()

const families = (f: AxisFamily[]): GantrySettings => ({
  x: { ...initialGantrySettings.x, families: f },
  y: { ...initialGantrySettings.y, families: f },
  z: { ...initialGantrySettings.z, families: f },
})
/** every family and drive open, so a picked axis is listed */
const open: GantrySettings = {
  x: { ...initialGantrySettings.x, families: ['ELGT', 'ELGD', 'EGC'], drives: ['belt', 'spindle'] },
  y: { ...initialGantrySettings.y, families: ['ELGT', 'ELGD', 'EGC'], drives: ['belt', 'spindle'] },
  z: { ...initialGantrySettings.z, families: ['ELGT', 'ELGD', 'EGC'], drives: ['belt', 'spindle'] },
}
const single = { ...defaultGantry.parallel, x: { ...defaultGantry.parallel.x, mode: 'single' as const } }

/** the app's defaults and the variations most likely to bring X and Z (or Y) together */
const scenarios: { name: string; g: GantryInputs; s: GantrySettings; ids?: Partial<Record<GantryAxis, string>>; options?: Partial<Record<GantryAxis, Partial<ComboOptions>>> }[] = [
  { name: 'xyz-default', g: defaultGantry, s: initialGantrySettings },
  { name: 'xyz-y-floor', g: { ...defaultGantry, yMounting: 'floor' }, s: initialGantrySettings },
  { name: 'xyz-single-x', g: { ...defaultGantry, parallel: single }, s: initialGantrySettings },
  { name: 'xyz-single-x-y-floor', g: { ...defaultGantry, parallel: single, yMounting: 'floor' }, s: initialGantrySettings },
  { name: 'xyz-long-z', g: { ...defaultGantry, motion: { ...defaultGantry.motion, z: { ...defaultGantry.motion.z, stroke: 500 } } }, s: initialGantrySettings },
  { name: 'xyz-z-profile', g: { ...defaultGantry, zMode: 'profile' }, s: initialGantrySettings },
  { name: 'xyz-heavy', g: { ...defaultGantry, payload: 20 }, s: initialGantrySettings },
  { name: 'xyz-elgd', g: defaultGantry, s: families(['ELGD']) },
  { name: 'xyz-egc', g: defaultGantry, s: families(['EGC']) },
  // axes picked so the Festo kits (EHAM-AK / -MA) and the custom EGC brackets join them
  { name: 'xyz-elgt-kits', g: defaultGantry, s: open, ids: { x: 'ELGT-BS-160-…10P', y: 'ELGT-BS-120-…10P', z: 'ELGT-BS-90-…10P' } },
  { name: 'xyz-elgt-kits-single-x', g: { ...defaultGantry, parallel: single }, s: open, ids: { x: 'ELGT-BS-160-…10P', y: 'ELGT-BS-120-…10P', z: 'ELGT-BS-90-…10P' } },
  { name: 'xyz-elgt-kits-long-z', g: { ...defaultGantry, motion: { ...defaultGantry.motion, z: { ...defaultGantry.motion.z, stroke: 400 } } }, s: open, ids: { x: 'ELGT-BS-160-…10P', y: 'ELGT-BS-120-…10P', z: 'ELGT-BS-90-…10P' } },
  // ELGT-TB as the base axis on the EHAM kits (its slide is the ELGT-BS slide's)
  { name: 'xyz-elgt-tb-base', g: defaultGantry, s: open, ids: { x: 'ELGT-TB-160', y: 'ELGT-BS-120-…10P', z: 'ELGT-BS-90-…10P' } },
  { name: 'xyz-elgt-tb-base-120', g: defaultGantry, s: open, ids: { x: 'ELGT-TB-120', y: 'ELGT-BS-120-…10P', z: 'ELGT-BS-90-…10P' } },
  { name: 'xyz-elgt-tb-base-single-x', g: { ...defaultGantry, parallel: single }, s: open, ids: { x: 'ELGT-TB-160', y: 'ELGT-BS-120-…10P', z: 'ELGT-BS-90-…10P' } },
  // ELGT-TB carried on the EHAM kits (Y), the pins and screws in its profile's bores: on the wall (EHAM-AK), and on
  // the floor on an EHAM-MA plate (XY, no Z: a Z cannot join a floor-mounted Y)
  { name: 'xyz-elgt-tb-y', g: defaultGantry, s: open, ids: { x: 'ELGT-BS-160-…10P', y: 'ELGT-TB-120', z: 'ELGT-BS-90-…10P' } },
  { name: 'xyz-elgt-tb-y-single-x', g: { ...defaultGantry, parallel: single }, s: open, ids: { x: 'ELGT-BS-160-…10P', y: 'ELGT-TB-120', z: 'ELGT-BS-90-…10P' } },
  { name: 'xyz-elgt-tb-y-120', g: { ...defaultGantry, parallel: single }, s: open, ids: { x: 'ELGT-BS-120-…10P', y: 'ELGT-TB-120', z: 'ELGT-BS-90-…10P' } },
  { name: 'xyz-elgt-tb-y-160', g: { ...defaultGantry, parallel: single }, s: open, ids: { x: 'ELGT-BS-160-…10P', y: 'ELGT-TB-160', z: 'ELGT-BS-90-…10P' } },
  // the TB motor beside its head points at the X axis unless on the other shaft end (motor positions 1 and 3)
  { name: 'xyz-elgt-tb-y-d1', g: defaultGantry, s: open, ids: { x: 'ELGT-BS-160-…10P', y: 'ELGT-TB-120', z: 'ELGT-BS-90-…10P' }, options: { y: { drive: DRIVE_POSITIONS[1] } } },
  { name: 'xyz-elgt-tb-y-120-d1', g: { ...defaultGantry, parallel: single }, s: open, ids: { x: 'ELGT-BS-120-…10P', y: 'ELGT-TB-120', z: 'ELGT-BS-90-…10P' }, options: { y: { drive: DRIVE_POSITIONS[1] } } },
  { name: 'xyz-elgt-tb-y-160-d1', g: { ...defaultGantry, parallel: single }, s: open, ids: { x: 'ELGT-BS-160-…10P', y: 'ELGT-TB-160', z: 'ELGT-BS-90-…10P' }, options: { y: { drive: DRIVE_POSITIONS[1] } } },
  ...[1, 2, 3].map((d) => ({ name: `xyz-elgt-tb-y-single-x-d${d}`, g: { ...defaultGantry, parallel: single }, s: open, ids: { x: 'ELGT-BS-160-…10P', y: 'ELGT-TB-120', z: 'ELGT-BS-90-…10P' }, options: { y: { drive: DRIVE_POSITIONS[d] } } })),
  { name: 'xy-elgt-tb-y-floor', g: { ...defaultGantry, config: 'xy', parallel: single, yMounting: 'floor' }, s: open, ids: { x: 'ELGT-BS-160-…10P', y: 'ELGT-TB-120' } },
  { name: 'xy-elgt-bs-y-floor-ref', g: { ...defaultGantry, config: 'xy', parallel: single, yMounting: 'floor' }, s: open, ids: { x: 'ELGT-BS-160-…10P', y: 'ELGT-BS-120-…10P' } },
  { name: 'xyz-egc-brackets', g: defaultGantry, s: open, ids: { x: 'EGC-120-…-TB-KF-GK', y: 'EGC-80-...-TB-KF-GK', z: 'EGC-70-...-BS-10P-KF-GK' } },
  { name: 'xyz-egc-brackets-y-floor', g: { ...defaultGantry, yMounting: 'floor' }, s: open, ids: { x: 'EGC-120-…-TB-KF-GK', y: 'EGC-80-...-TB-KF-GK', z: 'EGC-70-...-BS-10P-KF-GK' } },
]

describe.skipIf(!out)('export gantry drawings for the interference check', () => {
  for (const sc of scenarios.filter((s) => !only || only.split(',').includes(s.name)))
    it(sc.name, async () => {
      // the app picks the axis; the motor is the user's: the first listed one that passes and whose kit has a
      // drawing, tool axis first (each axis's load depends on the drive picked above it)
      const picks: Record<GantryAxis, typeof noPicks> = { x: { ...noPicks, axisId: sc.ids?.x ?? null }, y: { ...noPicks, axisId: sc.ids?.y ?? null }, z: { ...noPicks, axisId: sc.ids?.z ?? null } }
      let results = computeGantry(sc.g, sc.s, picks)
      for (const a of ['z', 'y', 'x'] as GantryAxis[]) {
        const r = results.find((x) => x.axis === a)
        if (!r?.sel) continue
        const drawn = (m: (typeof r.sel.motorResults)[number]) => m.kit && comboDrawings({ axis: r.sel!.selectedAxis!.axis, axisModel: '', stroke: 0, motor: m.motor, gearbox: m.gearbox, kit: m.kit.kit }, all).missing.length === 0
        const motor = r.sel.motorResults.find((m) => m.status !== 'fail' && drawn(m)) ?? r.sel.motorResults.find(drawn)
        if (!motor) throw new Error(`${sc.name}: no motor with drawings for ${a}`)
        if (sc.ids?.[a] && r.sel.selectedAxis!.axis.id !== sc.ids[a]) throw new Error(`${sc.name}: ${sc.ids[a]} not listed for ${a}`)
        picks[a] = { ...noPicks, axisId: r.sel.selectedAxis!.axis.id, motorId: motor.motor.id }
        results = computeGantry(sc.g, sc.s, picks)
      }
      const axes: GantryAxisDrawing[] = []
      for (const r of results) {
        const s = r.sel
        const axis = s?.selectedAxis
        const drive = s?.selectedDrive
        const kit = s?.selectedKitEval?.kit
        if (!r.req || !axis || !drive || !kit) throw new Error(`${sc.name}: no selection for ${r.axis}`)
        const req = { ...r.req, cog: axisCog(r.req) }
        const sel: ComboSelection = {
          axis: axis.axis,
          axisModel: axis.order.model,
          stroke: axis.order.stroke ?? req.stroke,
          motor: drive.motor,
          gearbox: drive.gearbox,
          kit,
        }
        const found = comboDrawings(sel, all)
        if (found.missing.length) throw new Error(`${sc.name}: no drawing for ${found.missing.join(', ')}`)
        const shaftDrawing = axis.shaft ? shaftDrawingFor(axis.shaft.shaft, all) : null
        const twin =
          axis.layout.axes > 1 && r.req.parallel
            ? {
                spacing: r.req.parallel.spacing,
                drive: axis.layout.mode === 'twinMotor',
                ...(axis.shaft && shaftDrawing ? { shaft: { model: axis.shaft.model, length: axis.shaft.length, drawing: shaftDrawing } } : {}),
              }
            : undefined
        axes.push({ axis: r.axis, sel, found, req: { mounting: req.mounting, cog: req.cog }, options: { ...defaultComboOptions, ...sc.options?.[r.axis] }, twin })
      }
      const joints: GantryJointDrawing[] = results.flatMap((r) =>
        r.joint
          ? [
              {
                base: r.joint.base,
                carried: r.joint.carried,
                kits: r.joint.kits.map((k) => ({ kit: k, drawing: adapterDrawingFor(k, all), mountings: mountingDrawingFor(k, all) })),
                offset: r.joint.offset,
                flange: r.joint.flange,
                driveSign: r.joint.driveSign,
                beam: r.joint.beam && {
                  bracket: r.joint.beam.bracket,
                  drawing: adapterDrawingFor(r.joint.beam.bracket, all) as Drawing<BeamMeta> | null,
                  length: r.joint.beam.length,
                  at: r.joint.beam.at,
                  plate: r.joint.beam.plate && { kit: r.joint.beam.plate, drawing: adapterDrawingFor(r.joint.beam.plate, all) },
                },
              },
            ]
          : [],
      )
      const combo = await buildGantry(sc.g, axes, joints, load)
      // a gantry kit belongs to the slide it stands on: the joint's base axis
      const kitBase = new Map<string, GantryAxis>()
      for (const j of joints) {
        for (const k of j.kits) kitBase.set(k.kit.model, j.base)
        if (j.beam) {
          kitBase.set(j.beam.bracket.model, j.base)
          if (j.beam.plate) kitBase.set(j.beam.plate.kit.model, j.base)
        }
      }
      const parts = combo.parts.map((p) => {
        const axis = /^([XYZ]) /.exec(p.name)?.[1].toLowerCase() as GantryAxis | undefined
        const kit = axis ? null : [...kitBase].find(([model]) => p.name.startsWith(model))
        // an axis part: where its slide surface centre is at the start position and the way the slide travels (world),
        // from its frame JSON (the slide moved with a length change at its end, as combo.ts does)
        let slide = null
        const d = axis && p.role === 'axis' ? axes.find((a) => a.axis === axis) : null
        const meta = d?.found.axis?.meta
        if (meta) {
          const origin = meta.stretch ? stretchedOrigin(meta.slide.origin, meta.stretch, d!.sel.stroke - meta.stroke) : meta.slide.origin
          slide = { origin: apply(p.transform, origin), normal: rotate(p.transform, meta.slide.normal), travel: rotate(p.transform, meta.slide.travel) }
        }
        return { name: p.name, role: p.role, axis: axis ?? null, base: kit?.[1] ?? null, slide }
      })
      const travel = Object.fromEntries(
        axes.map((a) => [a.axis, { t: axisFrame(sc.g, a.axis).t, stroke: a.sel.stroke, model: a.sel.axisModel, motor: a.sel.motor.model, kit: a.sel.kit.product }]),
      )
      mkdirSync(out!, { recursive: true })
      writeFileSync(join(out!, `${sc.name}.step`), combo.step)
      writeFileSync(join(out!, `${sc.name}.json`), JSON.stringify({ scenario: sc.name, config: sc.g.config, zMode: sc.g.zMode, yMounting: sc.g.yMounting, axes: travel, ySlide: combo.y ?? null, unkitted: combo.unkitted, parts }, null, 1))
    }, 600000)
})
