import type { Axis, AxisAdapter, ConnectingShaft, Gearbox, Kit, Motor } from '../data/types'
import type { Frame } from './geometry'
import type { StretchSpec } from './stretch'
import type { Vec3 } from './step'

// Manufacturer CAD files (STEP) live next to the product data: data/<kind>/<maker>/Drawings/…/<partNumber>_<model>.stp
// (Festo) or the maker's own file name (Mitsubishi `hg-kr13_.stp`), each with a JSON of the same name holding its
// mating frames (see data/README.md).

export type DrawingKind = 'axes' | 'motors' | 'gearboxes' | 'kits' | 'shafts' | 'adapters'

export interface AxisMeta {
  /** mm, stroke of the model in the file */
  stroke: number
  /** drive shaft: at the axis end face, `axis` pointing out towards the motor */
  drive: Frame
  /** slide mounting surface centre at the start position; `travel` = away from the motor; `pattern` = the centre of
   *  the slide's hole pattern on its surface where it is not on the profile centreline (EGC-TB/BS-KF: towards
   *  `front`), where a gantry kit sits */
  slide: { origin: Vec3; normal: Vec3; travel: Vec3; front?: Vec3; pattern?: Vec3 }
  /** how to change the length for other strokes */
  stretch?: StretchSpec
  /** the profile's mounting face (underside), middle of the length: where a gantry kit holds the axis */
  profile?: { origin: Vec3; normal: Vec3 }
}
/** Gantry kit (data/adapters): the face on the base axis's slide and the one the carried axis's profile sits on */
export interface AdapterMeta {
  /** `axis` from the base slide into the kit, `up` across the carried travel */
  base: Frame
  /** `axis` from the kit towards the carried axis (its slide side), `up` along the carried travel */
  carried: Frame
  /** a profile mounting (EAHF-E24-60-P-B4, a pair of jaws in the file): one jaw (the file's first instance), seated
   *  by the centre of its hole pattern on its underside, `axis` away from the kit, its lip towards −(axis × up) */
  mounting?: Frame
  /** an angle kit's seats for its profile mountings (EHAM-AK-E24: one per B4 jaw on the wall's threads, as the jaw's
   *  `mounting` frame) */
  mountings?: Frame[]
}
/** A custom cross beam (data/adapters/Custom, `joint: 'beam'`) at its reference `length` (mm, along file x from
 *  end A): `base` / `baseB` its end faces on the kits' profile centreline (as the carried profile's drive flange
 *  would sit), `carried` on its front face (the Z pad centre, or the Y drive flange on the Y centreline), `window` the
 *  span along x of the carried axis's holes (cut out before the length change), `yStroke` the Y stroke they are for */
export interface BeamMeta extends AdapterMeta {
  length: number
  baseB: Frame
  window: [number, number]
  yStroke?: number
}
export interface KitMeta {
  axisFace: Frame
  motorFace: Frame
}
export interface GearboxMeta {
  /** output flange (axis / kit side) and input flange (motor side) */
  output: Frame
  input: Frame
}
export interface ShaftMeta {
  /** mm, nominal length LN of the model in the file */
  length: number
  /** the end face on the motor-side axis (LN/2 from the middle), `axis` along the shaft towards the other end */
  end: Frame
  /** how to change the length for other nominal lengths (the tube between the couplings) */
  stretch: StretchSpec
}
export interface MotorMeta {
  flange: Frame
  /** direction the connector points to, ⟂ the shaft (default `flange.up`) */
  connector?: Vec3
}

export interface Drawing<M = unknown> {
  kind: DrawingKind
  maker: string
  /** data/… path, for messages */
  path: string
  url: string
  partNumber: string | null
  /** model name from the file name */
  model: string
  /** every model name the file stands for (`model` first) */
  names: string[]
  meta: M | null
}

const stepUrls = import.meta.glob<string>('../../data/*/*/Drawings/**/*.{stp,step,STP,STEP}', {
  query: '?url',
  import: 'default',
  eager: true,
})
const metaFiles = import.meta.glob<unknown>('../../data/*/*/Drawings/**/*.json', { import: 'default', eager: true })
// the custom brackets' shop drawings (committed, unlike the makers' PDFs)
const bracketPdfs = import.meta.glob<string>('../../data/adapters/Custom/Drawings/*.pdf', { query: '?url', import: 'default', eager: true })

/** URL of a custom bracket's drawing PDF (`AxisAdapter.drawing`, a data/… path); null when it is not there */
export const bracketDrawingUrl = (path: string | undefined): string | null => (path ? (bracketPdfs[`../../${path}`] ?? null) : null)

/**
 * Part number and model names from the file name: `<partNumber>_<model>` (CADENAS), else the model up to the first
 * `_`, upper case (Mitsubishi: `hg-kr13_`, `hg-ak0136_b_`); an optional `(4)` (400 V class) stands for both names
 * (`hg-jr12k1(4)_` = HG-JR12K1 and HG-JR12K14).
 */
export function parseDrawingPath(
  path: string,
): Pick<Drawing, 'kind' | 'maker' | 'partNumber' | 'model' | 'names' | 'path'> | null {
  const m = /data\/(axes|motors|gearboxes|kits|shafts|adapters)\/([^/]+)\/Drawings\/(?:.*\/)?([^/]+)\.(?:stp|step)$/i.exec(path)
  if (!m) return null
  const [, kind, maker, base] = m
  const named = /^(\d{5,})_(.+)$/.exec(base)
  const model = named?.[2] ?? base.split('_')[0].toUpperCase()
  const optional = /\((\w+)\)/.exec(model)
  const names = optional
    ? [model.replace(optional[0], ''), model.replace(optional[0], optional[1])]
    : [model]
  return {
    kind: kind as DrawingKind,
    maker,
    path: path.slice(path.indexOf('data/')),
    partNumber: named?.[1] ?? null,
    model: names[0],
    names,
  }
}

export const drawings: Drawing[] = Object.entries(stepUrls).flatMap(([path, url]) => {
  const info = parseDrawingPath(path)
  if (!info) return []
  const meta = metaFiles[path.replace(/\.[^.]+$/, '.json')] ?? null
  return [{ ...info, url, meta }]
})

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Axis drawings of the axis's type (any stroke), the one needing the least length change first. */
export function axisDrawingsFor(axis: Axis, stroke: number, all = drawings): Drawing<AxisMeta>[] {
  const code = axis.typeCode ?? axis.model
  const re = new RegExp(`^${code.split('…').map(escape).join('\\d+')}$`)
  return (all.filter((d) => d.kind === 'axes' && d.meta && d.names.some((n) => re.test(n))) as Drawing<AxisMeta>[]).sort(
    (a, b) => Math.abs(a.meta!.stroke - stroke) - Math.abs(b.meta!.stroke - stroke),
  )
}

export interface MotorDrawingMatch {
  drawing: Drawing<MotorMeta>
  /** the file is another option of the same motor (encoder, shaft …), same size */
  otherOptions: boolean
  /** the file is another motor's with the same outline dimensions (`Motor.sameOutline`) */
  sameOutline?: boolean
}

/**
 * The motor's drawing: same model or order code, else (Festo) another option variant of the same motor —
 * the order code adds option letters after the model (EMMT-AS-60-S-HS-RS, -RMY), B = brake, which changes the length.
 */
export function motorDrawingFor(motor: Motor, all = drawings): MotorDrawingMatch | null {
  const list = all.filter((d) => d.kind === 'motors' && d.maker === motor.maker) as Drawing<MotorMeta>[]
  const exact = list.find(
    (d) =>
      d.names.includes(motor.model) ||
      // Mitsubishi HK lists the voltage class in the model ("HK-KT13W (200V)"), the file name does not
      d.names.includes(motor.model.replace(/\s*\(\d+V\)$/, '')) ||
      (motor.orderCode != null && d.names.includes(motor.orderCode)) ||
      (motor.partNumber != null && d.partNumber === motor.partNumber),
  )
  if (exact) return { drawing: exact, otherOptions: false }
  const outline = motor.sameOutline ? list.find((d) => d.names.includes(motor.sameOutline!)) : null
  if (outline) return { drawing: outline, otherOptions: false, sameOutline: true }
  if (motor.maker === 'Siemens') {
    const variant = list.find((d) => d.names.some((n) => siemensVariant(motor.model, n)))
    return variant ? { drawing: variant, otherOptions: true } : null
  }
  if (motor.maker !== 'Festo') return null
  const base = motor.brake ? motor.model.replace(/-B$/, '') : motor.model
  const variant = list.find((d) => {
    if (!d.model.startsWith(`${base}-`)) return false
    const options = d.model.slice(base.length + 1)
    return !options.includes('-') && options.includes('B') === motor.brake
  })
  return variant ? { drawing: variant, otherOptions: true } : null
}

/**
 * Siemens files name the full order number (`1FK2102-1AG10-0MA0_3D_en.STP`), the data a shorter or other one:
 * 1FK2 stops at the brake digit (`1FK2102-1AG1` = with brake; the file adds shaft end, protection and encoder),
 * 1FL6 names the plain shaft (`…-1LG1`, `…-1LH1` with brake), whose featherkey versions (`…-1LA1`, `…-1LB1`) have the
 * same dimensions. A supply suffix (`1FK2104-4AF0 (230V)`, the motor's rating on the other supply) is left out.
 */
export function siemensVariant(motorModel: string, name: string): boolean {
  const model = motorModel.replace(/\s*\(\d+V\)$/, '')
  if (/^1FK2/.test(model)) return name.startsWith(model) && name.length > model.length
  const fl6 = /^(1FL6\d{3}-\d\w{4}-\d\w)([GH])(\d)$/.exec(model)
  return fl6 != null && name === `${fl6[1]}${fl6[2] === 'G' ? 'A' : 'B'}${fl6[3]}`
}

export const kitDrawingFor =(kit: Kit, all = drawings) =>
  (all.find(
    (d) => d.kind === 'kits' && (d.names.includes(kit.product) || (kit.partNumber != null && d.partNumber === kit.partNumber)),
  ) as Drawing<KitMeta> | undefined) ?? null

export const shaftDrawingFor = (shaft: ConnectingShaft, all = drawings) =>
  (all.find((d) => d.kind === 'shafts' && d.meta && d.partNumber === shaft.partNumber) as Drawing<ShaftMeta> | undefined) ?? null

/**
 * By model or part number; Apex files are named by size, stage and motor adapter (`AB0421-P0401100102` = AB042,
 * 1 stage), not by ratio, so `AB042-3` takes the file starting `AB0421-`. Each downloaded adapter fits every motor
 * the gearbox lists (Apex Design Tool).
 */
export function gearboxDrawingFor(gearbox: Gearbox, all = drawings): Drawing<GearboxMeta> | null {
  const apex = gearbox.maker === 'Apex' ? `${gearbox.model.replace(/-\d+$/, '')}${gearbox.stage ?? (gearbox.ratio > 10 ? 2 : 1)}-` : null
  return (
    (all.find(
      (d) =>
        d.kind === 'gearboxes' &&
        (d.names.includes(gearbox.model) ||
          (gearbox.partNumber != null && d.partNumber === gearbox.partNumber) ||
          (apex != null && d.maker === 'Apex' && d.model.startsWith(apex))),
    ) as Drawing<GearboxMeta> | undefined) ?? null
  )
}

/** A gantry kit's drawing by part number; a custom bracket (no part number) by its model (`<id>_<model>.stp`) */
export const adapterDrawingFor = (adapter: AxisAdapter, all = drawings) =>
  (all.find(
    (d) =>
      d.kind === 'adapters' &&
      d.meta &&
      (adapter.partNumber != null ? d.partNumber === adapter.partNumber : d.partNumber == null && d.names.includes(adapter.model)),
  ) as Drawing<AdapterMeta> | undefined) ?? null

/** The drawing of the profile mounting a gantry kit is ordered with (`accessories`, by part number; a `mounting`
 *  frame in its JSON): EAHF-E24-60-P-B4 on an EHAM-AK-E24 */
export function mountingDrawingFor(adapter: AxisAdapter, all = drawings): { model: string; drawing: Drawing<AdapterMeta> } | null {
  for (const a of adapter.accessories) {
    const d = all.find((d) => d.kind === 'adapters' && d.partNumber === a.partNumber && (d.meta as AdapterMeta | null)?.mounting)
    if (d) return { model: a.model, drawing: d as Drawing<AdapterMeta> }
  }
  return null
}
