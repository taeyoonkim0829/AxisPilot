import type { Sensing, SwitchRole } from '../calc/axisSelection'
import type { Mounting, Requirements } from '../calc/types'
import type { Axis, AxisMounting, Gearbox, GuideUnit, Kit, Motor, SensorPart } from '../data/types'
import { assemble, sourceNotice, type AssemblyPart } from './assemble'
import {
  axisDrawingsFor,
  gearboxDrawingFor,
  guideDrawingFor,
  kitDrawingFor,
  motorDrawingFor,
  sensorDrawingFor,
  type AxisMeta,
  type Drawing,
  type GearboxMeta,
  type GuideMeta,
  type KitMeta,
  type MotorMeta,
  type SensorMeta,
  type ShaftMeta,
} from './drawings'
import { add, apply, cross, dot, identity, invert, mate, rotate, scale, sub, turnAbout, type Frame, type Transform } from './geometry'
import { args, closure, directionBody, mapRefs, nextIdOf, parseStep, pointBody, pointOf, refs, typeOf, writeStep, type StepFile, type Vec3 } from './step'
import { stretchedOrigin, stretchPart } from './stretch'
import { definitionByName, definitionOf, placementAxes, placementIdsOf, shapeOf, solidsOf } from './structure'

export type PartRole = 'axis' | 'kit' | 'gearbox' | 'motor' | 'shaft' | 'adapter' | 'guide' | 'sensor'

export interface ComboSelection {
  axis: Axis
  /** ordered axis model (stroke filled in) */
  axisModel: string
  /** mm, ordered stroke */
  stroke: number
  /** additional slides (`AxisOptions`): left (ZL/KL) towards the drive head, right away from it; `pitch` mm between
   *  neighbouring slide centres. The ordered stroke includes them. */
  /** additional slides: side and centre distance from the slide (mm) */
  extraSlides?: { side: 'left' | 'right'; pitch: number }[]
  motor: Motor
  gearbox: Gearbox | null
  kit: Kit
  /** guide without drive: the EAGF on an electric cylinder (no `offsets`), or guide axes `offsets` mm beside the
   *  axis along the slide's lateral (+y) direction */
  guide?: { guide: GuideUnit; model: string; stroke: number; offsets: number[] }
  /** ELGD mounting type ordered (direct mounting M, front end M7): drawn from its own file when there is one */
  mounting?: AxisMounting | null
  /** position sensing: the switch lug on the (main) slide, the limit switches at the ends of the travel and the home
   *  switch beside the − limit (`switchPlacements`) */
  sensing?: Sensing | null
}

/** Drawings found for a selection; `missing` lists the parts without one (no assembly then). */
export interface ComboDrawings {
  axis: Drawing<AxisMeta> | null
  motor: Drawing<MotorMeta> | null
  motorOtherOptions: boolean
  /** the motor file is another model's with the same outline dimensions */
  motorSameOutline: boolean
  gearbox: Drawing<GearboxMeta> | null
  kit: Drawing<KitMeta> | null
  /** the guide's drawing; without one (or, EAGF, without the cylinder's `front` frame) the guide is left out */
  guide: Drawing<GuideMeta> | null
  /** the switch lug's, the switch bracket's and each proximity switch's drawing (as `sensing.switches`); null (left
   *  out) without one of them or the axis's `sensor` seats */
  sensors: { lug: Drawing<SensorMeta> | null; bracket: Drawing<SensorMeta> | null; switches: Drawing<SensorMeta>[]; fixing?: Drawing<SensorMeta> | null } | null
  /** a mounting type was ordered but has no file of its own: the standard profile is drawn */
  mountingMissing: boolean
  missing: PartRole[]
}

export function comboDrawings(sel: ComboSelection, all?: Drawing[]): ComboDrawings {
  // the mounting type's own file (its profile's underside), else the standard one
  const mounted = sel.mounting ? (axisDrawingsFor(sel.axis, sel.stroke, all, sel.mounting)[0] ?? null) : null
  const axis = mounted ?? axisDrawingsFor(sel.axis, sel.stroke, all)[0] ?? null
  const motor = motorDrawingFor(sel.motor, all)
  const gearbox = sel.gearbox ? gearboxDrawingFor(sel.gearbox, sel.motor, all) : null
  const kit = kitDrawingFor(sel.kit, all)
  const missing: PartRole[] = []
  if (!axis) missing.push('axis')
  if (!kit?.meta) missing.push('kit')
  if (sel.gearbox && !gearbox?.meta) missing.push('gearbox')
  if (!motor) missing.push('motor')
  const guide = sel.guide ? guideDrawingFor(sel.guide.guide, sel.guide.stroke, all) : null
  const lug = sel.sensing?.lug ? sensorDrawingFor(sel.sensing.lug, all) : null
  const bracket = sel.sensing?.bracket ? sensorDrawingFor(sel.sensing.bracket, all) : null
  const switches = (sel.sensing?.switches ?? []).map((s) => sensorDrawingFor(s.part, all))
  // the Omron sensors' fixing screws (left out without a drawing)
  const fixingModel = switches[0]?.meta?.fixing?.model
  const fixing = fixingModel ? sensorDrawingFor({ partNumber: '', maker: 'Omron', model: fixingModel } as SensorPart, all) : null
  return {
    axis,
    motor: motor?.drawing ?? null,
    motorOtherOptions: motor?.otherOptions ?? false,
    motorSameOutline: motor?.sameOutline ?? false,
    gearbox,
    kit,
    guide: guide && (sel.guide!.guide.kind === 'axis' || axis?.meta?.front) ? guide : null,
    mountingMissing: !!sel.mounting && !mounted,
    sensors:
      sel.sensing &&
      (lug || !sel.sensing.lug) &&
      (bracket?.meta?.slot || !sel.sensing.bracket) &&
      switches.every((d) => d != null) &&
      axis?.meta?.sensor &&
      !!lug === !!axis.meta.sensor.lug
        ? { lug, bracket, switches: switches as Drawing<SensorMeta>[], fixing }
        : null,
    missing,
  }
}

// Festo convention (flange at z = 0, shaft +z, connector +y); Mitsubishi's flange motors have their connectors at −y
const defaultMotorMeta = (maker: string): MotorMeta => ({
  flange: { origin: [0, 0, 0], axis: [0, 0, -1], up: [0, 1, 0] },
  ...(maker === 'Mitsubishi' ? { connector: [0, -1, 0] } : {}),
})

/** Direction seen from the motor end of the axis, looking along the axis with the slide surface up. */
export type Side = 'up' | 'down' | 'left' | 'right'
export const SIDES: readonly Side[] = ['up', 'down', 'left', 'right']

/** Where the EAGF's two guide rods sit beside the cylinder: above and below it, or left and right (`Side`s) */
export type GuideRods = 'upDown' | 'leftRight'

/**
 * Assembly orientation: the side a parallel kit puts the motor on (kit turned about the axis drive shaft) and where
 * the motor connector points (any kit). `motorConnector` null = automatic: away from the axis with a parallel kit
 * (the kit side), up with an axial kit.
 */
export interface ComboOptions {
  kitSide: Side
  motorConnector: Side | null
  /** Belt axes: where the drive sits (ignored for other axes) */
  drive: DrivePosition
  /** Belt axes, motor sync: where the second axis's drive sits; null = the mirror image of the first (`mirroredDrive`) */
  twinDrive?: DrivePosition | null
  /** Motor sync: the second axis's kit side and motor connector; null = like the first */
  twinKitSide?: Side | null
  twinMotorConnector?: Side | null
  /** Motor sync: both axes turned on their sides about their travel, the slides facing each other across the
   *  spacing (`facingTurn`); false = side by side, slides up */
  twinFacing?: boolean
  /** the slide drawn in the middle of the profile (the middle of its travel) instead of at the start position; the
   *  gantry drawing's Y axis */
  slideCentred?: boolean
  /** EAGF on an ESBF: its guide rods left and right of the cylinder (default) or above and below; drawing only, the
   *  data sheet loads are the same both ways (Fy = Fz, My = Mz) */
  guideRods?: GuideRods
  /** The side the position sensing goes on (`sensorSides`); null = as the axis JSON's seats put it */
  sensorSide?: Side | null
}

/**
 * The sides the position sensing can go on, seen from the motor end with the slide surface up (`Side`), and the one
 * the axis JSON's `sensor` seats put it on: an ESBF on any face of its square profile, an axis with a slide on
 * either side of the profile; none for EGC, whose slide stands out to one side (the lug's face on the other side is
 * not measured). `turn` moves a seat frame to `side`: the cylinder's turned about its rod axis, the slide axis's
 * mirrored across the profile's middle plane (lug, slot and bracket seats are mirror images; the parts placed on
 * them come out turned, not mirrored).
 */
export function sensorSides(meta: AxisMeta | null | undefined) {
  const seats = meta?.sensor
  if (!meta || !seats || !meta.profile || meta.slide.front) return null
  const { normal: up, travel } = meta.slide
  const out = scale(travel, Math.sign(dot(sub(meta.drive.origin, meta.profile.origin), travel)) || 1)
  const right = cross(up, out)
  const vector = (s: Side) => (s === 'up' ? up : s === 'down' ? scale(up, -1) : s === 'right' ? right : scale(right, -1))
  const cylinder = !seats.lug
  // the cylinder's rod axis lies on the drive frame's line; a slide axis's profile middle on the profile frame
  const v = sub(seats.lug?.origin ?? seats.slot.origin, cylinder ? meta.drive.origin : meta.profile.origin)
  const [du, dr] = [dot(v, up), dot(v, right)]
  const filed: Side = cylinder && Math.abs(du) > Math.abs(dr) ? (du > 0 ? 'up' : 'down') : dr > 0 ? 'right' : 'left'
  const options: readonly Side[] = cylinder ? SIDES : ['left', 'right']
  const turn = (side: Side) => {
    if (side === filed || !options.includes(side)) return (f: Frame) => f
    if (cylinder) {
      const m = turnAbout(identity, meta.drive.origin, scale(out, 1 / Math.hypot(...out)), vector(filed), vector(side))
      return (f: Frame): Frame => ({ origin: apply(m, f.origin), axis: rotate(m, f.axis), up: rotate(m, f.up) })
    }
    const n = scale(right, 1 / Math.hypot(...right))
    const o = meta.profile!.origin
    const mirror = (w: Vec3) => sub(w, scale(n, 2 * dot(w, n)))
    return (f: Frame): Frame => ({ origin: add(o, mirror(sub(f.origin, o))), axis: mirror(f.axis), up: mirror(f.up) })
  }
  return { filed, options, turn }
}

/**
 * A belt axis takes the motor on either end of its drive shaft and can be turned end for end: `otherEnd` turns the
 * axis about its slide normal (the drive head at the other end of the travel), `otherSide` uses the other shaft end.
 */
export interface DrivePosition {
  otherEnd: boolean
  otherSide: boolean
}
export const DRIVE_POSITIONS: readonly DrivePosition[] = [
  { otherEnd: false, otherSide: false },
  { otherEnd: false, otherSide: true },
  { otherEnd: true, otherSide: false },
  { otherEnd: true, otherSide: true },
]
export const defaultComboOptions: ComboOptions = { kitSide: 'down', motorConnector: null, drive: DRIVE_POSITIONS[0] }

const turnable = (axis: Axis) => axis.drive === 'belt'

/**
 * The second belt axis of a twin pair mirrors the first across the plane between them, its drive head at the same
 * end. A centred slide (ELGD-TB, EGC-HD-TB): the motor on the other shaft end. A slide standing out to one side
 * (`slide.front`, EGC-TB-KF): the same position, drawn mirrored (`comboParts`: the axis turned end for end with its
 * drive at the other head). Its drive train is assembled on the turned axis, the sides meaning the same directions as on the first.
 */
export const mirroredDrive = (meta: AxisMeta | null, position: DrivePosition): DrivePosition =>
  meta?.slide.front ? position : { ...position, otherSide: !position.otherSide }

/**
 * Words for the second axis's position, by the direction its motor points in the drawing, as the first's: drawn
 * mirrored (`slide.front`) the motor points the way the other shaft end would on the first, so the same words mean
 * the same direction on both axes.
 */
export const twinPositionWords = (meta: AxisMeta, mounting: Mounting, position: DrivePosition, facing = false) =>
  drivePositionWords(meta, mounting, meta.slide.front ? { ...position, otherSide: !position.otherSide } : position, facing ? -1 : 0)

/** The slide when it is a part of its own (EGC-TB-KF: …-GK-GPTB1--------(0); ELGD-TB: …---(high_s), WD …---(highs);
 *  ELGT-BS: …---(high_0_s)) */
const SLIDE_PART = /TB1-{4,}|---\(high_?(0_)?s\)/

/**
 * Adds instances of the slide part `shifts` (file mm) from where it sits: copies of its assembly occurrence (usage,
 * shape, transformation) with the placement moved. False when the slide is no part of its own.
 */
function copySlide(file: StepFile, shifts: Vec3[]): boolean {
  const e = file.entities
  const pd = definitionByName(file, SLIDE_PART)
  const find = (type: string, test: (r: number[]) => boolean) => [...e].find(([, b]) => typeOf(b) === type && test(refs(b)))
  const nauo = pd == null ? undefined : find('NEXT_ASSEMBLY_USAGE_OCCURRENCE', (r) => r[1] === pd)
  const pds = nauo && find('PRODUCT_DEFINITION_SHAPE', (r) => r.at(-1) === nauo[0])
  const cdsr = pds && find('CONTEXT_DEPENDENT_SHAPE_REPRESENTATION', (r) => r[1] === pds[0])
  const rel = cdsr ? e.get(refs(cdsr[1])[0]) : undefined
  const idt = rel ? refs(rel)[2] : undefined
  const placement = idt != null ? refs(e.get(idt) ?? '')[1] : undefined
  const location = placement != null ? refs(e.get(placement) ?? '')[0] : undefined
  const at = location != null ? pointOf(e.get(location) ?? '') : null
  if (!nauo || !pds || !cdsr || !rel || idt == null || placement == null || location == null || !at) return false
  let next = nextIdOf(e)
  shifts.forEach((shift, i) => {
    const [p, pl, t, r, n, s, c] = [next, next + 1, next + 2, next + 3, next + 4, next + 5, next + 6]
    next += 7
    e.set(p, pointBody(add(at, shift)))
    e.set(pl, mapRefs(e.get(placement)!, (id) => (id === location ? p : id)))
    e.set(t, mapRefs(e.get(idt)!, (id) => (id === placement ? pl : id)))
    e.set(r, mapRefs(rel, (id) => (id === idt ? t : id)))
    // its own id string (the first argument)
    e.set(n, nauo[1].replace(/^(\s*NEXT_ASSEMBLY_USAGE_OCCURRENCE\s*\(\s*')[^']*/, `$1SLIDE${i + 2}`))
    e.set(s, mapRefs(pds[1], (id) => (id === nauo[0] ? n : id)))
    e.set(c, mapRefs(cdsr[1], (id) => (id === refs(cdsr[1])[0] ? r : id === pds[0] ? s : id)))
  })
  return true
}

/** Parts of their own that sit on the slide: ELGT-BS's grease nipples, ELGD's set screws */
const SLIDE_FITTINGS = /ELGT-M6X0,75|ISO-4026 M\d+x\d+/

/** Moves the slide part with its fittings by `shift` (file mm). False when it is no part of its own. */
function moveSlide(file: StepFile, shift: Vec3): boolean {
  const moved = placePart(file, SLIDE_PART, { r: identity.r, t: shift })
  if (moved) placePart(file, SLIDE_FITTINGS, { r: identity.r, t: shift })
  return moved
}

/**
 * Places every instance of the part named `name` by `t` (file coordinates) on top of where it sits, editing the
 * entities (new points and directions: the old ones may be shared). False when there is no such part.
 */
export function placePart(file: StepFile, name: string | RegExp, t: Transform): boolean {
  const pd = definitionByName(file, name)
  const rep = pd != null ? shapeOf(file, pd) : null
  const placements = rep != null ? placementIdsOf(file, rep) : []
  const e = file.entities
  const direction = (id: number) => pointOf((e.get(id) ?? '').replace(/^DIRECTION/, 'CARTESIAN_POINT'))
  let next = nextIdOf(e)
  for (const id of placements) {
    const body = e.get(id)!
    const [location, z, x] = refs(body)
    const p = pointOf(e.get(location) ?? '')
    if (!p) return false
    const renamed = new Map<number, number>([[location, next]])
    e.set(next++, pointBody(apply(t, p)))
    for (const old of [z, x]) {
      const d = old == null ? null : direction(old)
      if (old == null || !d) continue
      renamed.set(old, next)
      e.set(next++, directionBody(rotate(t, d)))
    }
    e.set(id, mapRefs(body, (r) => renamed.get(r) ?? r))
  }
  return placements.length > 0
}

/** Drive shaft frame on the other side of a belt drive head: mirrored across the profile's middle plane */
function otherShaftEnd(drive: Frame, slide: AxisMeta['slide']): Frame {
  const off = dot(sub(drive.origin, slide.origin), drive.axis)
  return { ...drive, origin: sub(drive.origin, scale(drive.axis, 2 * off)), axis: scale(drive.axis, -1) }
}

/**
 * Where the motor sits, for the position choice (Korean words): the end of the axis the drive head is at, as in the
 * front view (X right, Z up, seen from −Y), and the shaft end it uses. Along the travel the ends are 앞 (−X, left in
 * the front view) and 뒤 (+X); across it the shaft ends are 우측 on the side the slide stands out to (`slide.front`,
 * EGC-TB-KF) and 좌측 on the other; a centred slide (ELGD-TB, EGC-HD-TB) names the side in the front view (우측 =
 * towards the viewer, −Y). `order` sorts the choices: end, then 좌측 before 우측. `facing`: the axis turned on its
 * side, its slide towards the other axis of a facing pair (`facingTurn`: 1 the first, −1 the second).
 */
export function drivePositionWords(
  meta: AxisMeta,
  mounting: Mounting,
  position: DrivePosition,
  facing: 0 | 1 | -1 = 0,
): { end: string; side: string; order: number } {
  const placed = axisToWorldOf(meta, mounting, position)
  const toWorld = facing ? facingTurn(placed, mounting, facing) : placed
  const end = rotate(toWorld, scale(meta.slide.travel, -1))
  const drive = position.otherSide ? otherShaftEnd(meta.drive, meta.slide) : meta.drive
  const side = rotate(toWorld, drive.axis)
  const main = (v: Vec3) => [0, 1, 2].reduce((a, b) => (Math.abs(v[b]) > Math.abs(v[a]) ? b : a))
  const front = meta.slide.front
  // X: 앞/뒤, Y: 좌측/우측, Z: 위/아래
  const ends: [string, string][] = [['앞', '뒤'], ['좌측', '우측'], ['위쪽', '아래쪽']]
  const sides: [string, string][] = [['앞', '뒤'], ['우측', '좌측'], ['위', '아래']]
  // first word of each pair for the negative direction, except up (Z +) and its end, which come first
  const pick = (v: Vec3, names: [string, string][]) => {
    const k = main(v)
    const first = k === 2 ? v[k] > 0 : v[k] < 0
    return { word: names[k][first ? 0 : 1], rank: first ? 0 : 1 }
  }
  const e = pick(end, ends)
  const s = front
    ? { word: dot(drive.axis, front) > 0 ? '우측' : '좌측', rank: dot(drive.axis, front) > 0 ? 1 : 0 }
    : pick(side, sides)
  return { end: e.word, side: s.word, order: e.rank * 2 + s.rank }
}

/** Axis file → world: slide centre at the origin, travel and slide normal by the mounting; turned end for end on request */
function axisToWorldOf(meta: AxisMeta, mounting: Mounting, position: DrivePosition, slideOrigin = meta.slide.origin): Transform {
  const world = mountingFrame(mounting)
  const slideFrame: Frame = { origin: slideOrigin, axis: meta.slide.travel, up: meta.slide.normal }
  const travel = position.otherEnd ? scale(world.travel, -1) : world.travel
  return mate(identity, { origin: [0, 0, 0], axis: travel, up: world.normal }, slideFrame)
}

/** World direction from the first axis of a twin arrangement to the second (the slide's lateral +y) */
const twinDirection = (mounting: Mounting): Vec3 => {
  const world = mountingFrame(mounting)
  return cross(world.normal, world.travel)
}

/**
 * Facing pair: a placed part turned a quarter turn about the travel line through `pivot` (its axis's slide centre),
 * the slide normal onto the lateral direction: `sign` 1 towards the second axis (the first axis), −1 back (the second).
 */
function facingTurn(m: Transform, mounting: Mounting, sign: 1 | -1, pivot: Vec3 = [0, 0, 0]): Transform {
  const world = mountingFrame(mounting)
  return turnAbout(m, pivot, world.travel, world.normal, scale(twinDirection(mounting), sign))
}

/** The motor's shaft end points towards the second axis of a twin arrangement */
export function motorFacesTwin(meta: AxisMeta, mounting: Mounting, position: DrivePosition): boolean {
  const drive = position.otherSide ? otherShaftEnd(meta.drive, meta.slide) : meta.drive
  return dot(rotate(axisToWorldOf(meta, mounting, position), drive.axis), twinDirection(mounting)) > 0
}

/**
 * With a connecting shaft the motor sits on the drive shaft end away from the second axis (the shaft takes the
 * other end): a position with the motor towards it moves the motor to the other end of the same drive head.
 */
export function shaftDrivePosition(meta: AxisMeta, mounting: Mounting, position: DrivePosition): DrivePosition {
  return motorFacesTwin(meta, mounting, position) ? { ...position, otherSide: !position.otherSide } : position
}

/** Shaft cover caps: CADENAS names them (CUP), the ELGT-TB-120/-160-…-CS Creo files by their Festo part number */
const CAP = /\(CUP\)|^'249342[45]'$/

/** Shaft cover caps (CUP) at the drive head on the side `end` faces */
function capsAt(file: StepFile, end: Frame, slide: AxisMeta['slide']) {
  const pd = definitionByName(file, CAP)
  const rep = pd != null ? shapeOf(file, pd) : null
  if (rep == null) return []
  const centre = sub(end.origin, scale(end.axis, dot(sub(end.origin, slide.origin), end.axis)))
  return placementIdsOf(file, rep).filter((id) => {
    const location = pointOf(file.entities.get(refs(file.entities.get(id) ?? '')[0]) ?? '')
    return (
      location != null &&
      Math.abs(dot(sub(location, end.origin), slide.travel)) < 100 &&
      dot(sub(location, centre), end.axis) > 0
    )
  })
}

/** A copy of the axis file without the shaft cover caps on the side `end` faces (a connecting shaft goes there) */
function withoutCaps(file: StepFile, end: Frame, slide: AxisMeta['slide']): StepFile {
  const caps = capsAt(file, end, slide)
  return caps.length ? withoutInstances(file, caps) : file
}

/** A copy of an assembly file without the component instances at these placements (AXIS2_PLACEMENT_3D ids) */
export function withoutInstances(file: StepFile, placements: number[]): StepFile {
  const e = new Map(file.entities)
  const find = (test: (body: string) => boolean) => [...e].find(([, b]) => test(b))?.[0]
  for (const placement of placements) {
    // the instance: transformation → relationship → context dependent shape → its shape → the assembly usage
    const idt = find((b) => typeOf(b) === 'ITEM_DEFINED_TRANSFORMATION' && refs(b)[1] === placement)
    if (idt == null) continue
    const rel = find((b) => new RegExp(String.raw`REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION\s*\(\s*#${idt}\s*\)`).test(b))
    const cdsr = rel == null ? undefined : find((b) => typeOf(b) === 'CONTEXT_DEPENDENT_SHAPE_REPRESENTATION' && refs(b)[0] === rel)
    const pds = cdsr == null ? undefined : refs(e.get(cdsr)!)[1]
    const nauo = pds == null ? undefined : refs(e.get(pds) ?? '')[0]
    const part = nauo == null ? undefined : refs(e.get(nauo) ?? '')[1]
    for (const id of [cdsr, rel, idt, pds, nauo]) if (id != null) e.delete(id)
    // its last instance gone, a part left defined would read as a free part at the origin
    if (part == null || find((b) => typeOf(b) === 'NEXT_ASSEMBLY_USAGE_OCCURRENCE' && refs(b)[1] === part) != null) continue
    const shape = find((b) => typeOf(b) === 'PRODUCT_DEFINITION_SHAPE' && refs(b).at(-1) === part)
    const sdr = shape == null ? undefined : find((b) => typeOf(b) === 'SHAPE_DEFINITION_REPRESENTATION' && refs(b)[0] === shape)
    for (const id of [sdr, shape, part]) if (id != null) e.delete(id)
  }
  return { header: file.header, entities: e }
}

/**
 * Moves the shaft cover caps (CUP) off the drive's new shaft end to the end it left: each cap at the drive head on
 * the new side turns half a turn about the head's vertical line through the shaft. Heads capped on both sides
 * (EGC-HD-TB) keep their caps.
 */
function moveCaps(file: StepFile, drive: Frame, slide: AxisMeta['slide']) {
  const pd = definitionByName(file, CAP)
  const rep = pd != null ? shapeOf(file, pd) : null
  if (rep == null) return
  const e = file.entities
  const along = slide.travel
  const centre = sub(drive.origin, scale(drive.axis, dot(sub(drive.origin, slide.origin), drive.axis)))
  const caps = placementIdsOf(file, rep).map((id) => {
    const body = e.get(id)!
    const [location, z, x] = refs(body)
    return { id, body, location: pointOf(e.get(location) ?? '')!, z, x }
  })
  const atHead = caps.filter((c) => c.location && Math.abs(dot(sub(c.location, drive.origin), along)) < 100)
  const onSide = (c: (typeof caps)[number], s: number) => dot(sub(c.location, centre), drive.axis) * s > 0
  if (atHead.some((c) => onSide(c, -1))) return
  const n = slide.normal
  const half = (v: Vec3) => sub(scale(n, 2 * dot(v, n)), v)
  const direction = (id: number | undefined) => (id == null ? null : pointOf((e.get(id) ?? '').replace(/^DIRECTION/, 'CARTESIAN_POINT')))
  let next = nextIdOf(e)
  for (const c of atHead.filter((cap) => onSide(cap, 1))) {
    // new point and directions: the old ones may be shared
    const renamed = new Map<number, number>()
    renamed.set(refs(c.body)[0], next)
    e.set(next++, pointBody(add(centre, half(sub(c.location, centre)))))
    for (const old of [c.z, c.x]) {
      const d = direction(old)
      if (old == null || !d) continue
      renamed.set(old, next)
      e.set(next++, directionBody(half(d)))
    }
    e.set(c.id, mapRefs(c.body, (id) => renamed.get(id) ?? id))
  }
}

/**
 * The axis's own jaw coupling hub (ELGT-BS, ELGD-BS: in the axis file) turned about the drive shaft so its jaws go
 * between those of the kit's hub (`kitJaw`, axis file coordinates) rather than into them: the smallest turn, a jaw
 * pitch being the same. A copy of the file; unchanged when already in line.
 */
function turnHub(file: StepFile, hub: NonNullable<AxisMeta['coupling']>, drive: Frame, kitJaw: Vec3): StepFile {
  const k = drive.axis
  const across = (v: Vec3) => sub(v, scale(k, dot(v, k)))
  const a = across(hub.jaw)
  const b = across(kitJaw)
  const pitch = (2 * Math.PI) / hub.count
  let angle = Math.atan2(dot(cross(a, b), k), dot(a, b))
  angle -= pitch * Math.round(angle / pitch)
  if (Math.abs(angle) < 1e-3) return file
  const turn = turnAbout(identity, drive.origin, k, a, add(scale(a, Math.cos(angle)), scale(cross(k, a), Math.sin(angle))))
  const copy: StepFile = { header: file.header, entities: new Map(file.entities) }
  return placePart(copy, hub.part, turn) ? copy : file
}

/**
 * The kit's coupling where the file has it touching the axis (`KitMeta.couplingShift`): turned end for end about
 * `flip` (its centre; its bores the other way round) and moved `by` mm along the shaft. Edits the file.
 */
export function placeCoupling(file: StepFile, kit: KitMeta) {
  const s = kit.couplingShift
  if (!s) return
  const f = kit.axisFace
  const flip = s.flip ? turnAbout(identity, s.flip, f.up, f.axis, scale(f.axis, -1)) : identity
  const t: Transform = { r: flip.r, t: add(flip.t, scale(f.axis, s.by)) }
  for (const part of s.parts) placePart(file, part, t)
}

/** Screws, nuts and seals by their names in Festo's kit files (`DIN-912 - M6x12(F)`, `8098119 M4`, `… M3-NBR-…`) */
const FASTENER = /ISO|DIN|\bM\d+(x\d|\b|-)/i

/**
 * A copy of a Festo kit file without the fasteners lying wholly beyond the motor face, in the motor drawn there:
 * the EAMM files park spare screws there (EAMM-A-D32-40P: four M6x12 47 mm deep) and seat the motor's own screws,
 * nuts and seals on a nominal flange, which the motor's flange is not.
 */
export function withoutLooseFasteners(file: StepFile, kit: KitMeta): StepFile {
  const f = kit.motorFace
  const e = file.entities
  const loose: number[] = []
  for (const [product, body] of e) {
    if (typeOf(body) !== 'PRODUCT' || !FASTENER.test(args(body)[0])) continue
    const pd = definitionOf(file, product)
    const rep = pd != null ? shapeOf(file, pd) : null
    if (rep == null) continue
    const points = solidsOf(file, rep).flatMap((s) =>
      [...closure(file, s)].flatMap((id) => {
        const b = e.get(id) ?? ''
        const p = typeOf(b) === 'CARTESIAN_POINT' ? pointOf(b) : null
        return p ? [p] : []
      }),
    )
    if (!points.length) continue
    for (const id of placementIdsOf(file, rep)) {
      const placed = placementAxes(file, id)
      if (!placed) continue
      const [xx, yy, zz] = placed.axes
      const depth = (p: Vec3) => dot(sub(add(placed.origin, add(scale(xx, p[0]), add(scale(yy, p[1]), scale(zz, p[2])))), f.origin), f.axis)
      if (Math.min(...points.map(depth)) > 1) loose.push(id)
    }
  }
  return loose.length ? withoutInstances(file, loose) : file
}

export const connectorSide = (options: ComboOptions, parallel: boolean): Side =>
  options.motorConnector ?? (parallel ? options.kitSide : 'up')

/**
 * The second axis's orientation under motor sync as options of its own: its kit side and connector, else the
 * first's (a kit side of its own with no connector picked turns the connector automatically to it). Sides mean the
 * same directions as on the first axis (`comboParts` swaps left and right when its motor end faces the other way).
 */
export const twinOrientation = (options: ComboOptions): ComboOptions => ({
  ...options,
  kitSide: options.twinKitSide ?? options.kitSide,
  motorConnector: options.twinMotorConnector ?? (options.twinKitSide == null ? options.motorConnector : null),
})

/** Left and right swapped: the sides seen from the motor end of a mirror image */
const mirrorSide: Record<Side, Side> = { up: 'up', down: 'down', left: 'right', right: 'left' }
const mirrorSides = (options: ComboOptions): ComboOptions => ({
  ...options,
  kitSide: mirrorSide[options.kitSide],
  motorConnector: options.motorConnector && mirrorSide[options.motorConnector],
})

const opposite: Record<Side, Side> = { up: 'down', down: 'up', left: 'right', right: 'left' }

/** Warnings about the chosen orientation (Korean source text), shown in step 5 and the report. */
export function assemblyWarnings(options: ComboOptions, parallel: boolean, cylinder?: { eagf: boolean } | null): string[] {
  if (!parallel) return []
  const warnings: string[] = []
  // an electric cylinder has no slide: the motor beside it meets the cylinder body and, with the EAGF, the guide
  // housing and rods (the rods run back along the cylinder from its front flange)
  if (cylinder) {
    if (connectorSide(options, parallel) === opposite[options.kitSide])
      warnings.push(
        cylinder.eagf
          ? '모터 커넥터가 실린더 쪽을 향합니다. 실린더 본체 및 EAGF 가이드 하우징·로드와의 간섭을 확인하세요.'
          : '모터 커넥터가 실린더 쪽을 향합니다. 실린더 본체와의 간섭을 확인하세요.',
      )
    const rods: Side[] = options.guideRods === 'upDown' ? ['up', 'down'] : ['left', 'right']
    if (cylinder.eagf && rods.includes(options.kitSide))
      warnings.push('모터가 EAGF 가이드 로드 쪽에 있어 가이드 하우징·로드와 간섭할 수 있습니다. 키트 조립 방향이나 가이드 방향을 바꾸세요.')
    return warnings
  }
  if (connectorSide(options, parallel) === opposite[options.kitSide])
    warnings.push('모터 커넥터가 축 쪽을 향합니다. 간섭을 확인하세요.')
  if (options.kitSide === 'up')
    warnings.push('모터가 슬라이드 쪽에 있어 슬라이드·부하와 간섭할 수 있으므로 사용 가능한 스트로크가 줄어들 수 있습니다.')
  return warnings
}

/** mm: a limit switch switches this far before the hardware limit (the end of the travel), protecting the machine */
export const LIMIT_MARGIN = 2

const SWITCH_NAMES: Record<SwitchRole, string> = { limitMinus: '-LIMIT', limitPlus: '+LIMIT', home: 'HOME' }

/**
 * Where the proximity switches go along the travel, in mm of the main slide's centre from its start position (0,
 * travelling towards +): `end` = the switch's sensing end, `facing` = the way that end points (±1 along the travel).
 * The lug (reaching `edge` mm either side of the slide centre) covers a switch whose switching point (`point` mm
 * behind its sensing end) lies under it. Limit switches switch `LIMIT_MARGIN` before the end of the travel when the
 * lug comes in from the middle, their sensing ends towards the middle and their cables towards the axis ends; the
 * home switch lies sensing end to sensing end with the − limit towards +, its cable towards + (as the user set it:
 * the cables lead away from the pair).
 * (`length` mm, sensing end to cable end, or its bracket: only the Omron cases use it.)
 * `outwards` (Omron sensors on brackets, `end` = the bracket's end at the sensor, connector pointing the other way):
 * the limits on their brackets' inner ends, connectors towards the axis ends; home back to back with the − limit on
 * the next bracket inwards, its connector towards +. `limitsInwards` (axis JSON `sensor.limitsInwards`, ELGD-60): the
 * limits the other way round, on their brackets' outer ends so the brackets reach inwards, clear of the heads and kit;
 * home on the next bracket in, its connector towards +.
 */
export function switchPlacements(
  roles: SwitchRole[],
  travel: number,
  edge: number,
  point: number[],
  length: number[],
  outwards = false,
  limitsInwards = false,
): { end: number; facing: 1 | -1 }[] {
  const minus = roles.indexOf('limitMinus')
  if (outwards && limitsInwards) {
    // the limits facing the axis ends, their brackets reaching inwards; home on the next bracket in, connector
    // towards + (away from the − limit)
    const outer = LIMIT_MARGIN - edge - (minus >= 0 ? point[minus] : 0)
    return roles.map((role, i) =>
      role === 'limitMinus'
        ? { end: outer, facing: -1 as const }
        : role === 'limitPlus'
          ? { end: travel - LIMIT_MARGIN + edge + point[i], facing: 1 as const }
          : { end: outer + (minus >= 0 ? length[minus] : 0), facing: -1 as const },
    )
  }
  if (outwards) {
    // the − limit's bracket end (and the home's, abutting it) `point` beyond its switching point towards +
    const inner = LIMIT_MARGIN - edge + (minus >= 0 ? point[minus] : 0)
    return roles.map((role, i) =>
      role === 'limitMinus'
        ? { end: inner, facing: 1 as const }
        : role === 'limitPlus'
          ? { end: travel - LIMIT_MARGIN + edge - point[i], facing: -1 as const }
          : { end: inner, facing: -1 as const },
    )
  }
  // the − limit's switching point at LIMIT_MARGIN − edge, its sensing end beyond it towards +, home's against it
  const minusEnd = LIMIT_MARGIN - edge + (minus >= 0 ? point[minus] : 0)
  return roles.map((role, i) =>
    role === 'limitMinus'
      ? { end: minusEnd, facing: 1 as const }
      : role === 'limitPlus'
        ? { end: travel - LIMIT_MARGIN + edge - point[i], facing: -1 as const }
        : { end: minusEnd, facing: -1 as const },
  )
}

/**
 * Where the proximity switches go on a cylinder body sensing the piston's magnet (ESBF), in mm from its front face
 * (rod end) towards the drive end (`body` mm long): `end` = the switch's sensing end, `facing` = the way it points
 * (+1 towards the front). Each switch is centred in a mounting `pitch[i]` mm long (its bracket); the mountings stay
 * within the sensor area (`area` = [L1 from the front, L2 from the drive end]): the − limit's at L1, the + limit's at
 * L2, cables towards the body ends; the home switch's right beside the + limit's (the motor end) towards −, sensing
 * end to sensing end with it, its cable towards the front (as the user set it: the cables lead away from the pair).
 */
export function bodySwitchPlacements(
  roles: SwitchRole[],
  body: number,
  length: number[],
  pitch: number[],
  area: [number, number],
): { end: number; facing: 1 | -1 }[] {
  const plus = roles.indexOf('limitPlus')
  const inset = (i: number) => (pitch[i] - length[i]) / 2
  const plusMount = body - area[1]
  return roles.map((role, i) =>
    role === 'limitMinus'
      ? { end: area[0] + inset(i) + length[i], facing: -1 as const }
      : role === 'limitPlus'
        ? { end: plusMount - inset(i) - length[i], facing: 1 as const }
        : { end: plusMount - (plus >= 0 ? pitch[plus] : 0) - inset(i), facing: -1 as const },
  )
}

/** A switch file with its cable stub cut short (`SensorMeta.trim`) */
function trimmed(file: StepFile, trim: SensorMeta['trim']): StepFile {
  for (const { range, by } of trim?.cuts ?? []) file = stretchPart(file, { part: trim!.part, axis: trim!.axis, dir: trim!.dir, range }, -by).file
  return file
}

/** The file without the instances of the named parts (a sensor file's spare fixings, cable clips) */
function withoutParts(file: StepFile, names: string[] = []): StepFile {
  for (const name of names) {
    const pd = definitionByName(file, name)
    const rep = pd != null ? shapeOf(file, pd) : null
    if (rep != null) file = withoutInstances(file, placementIdsOf(file, rep))
  }
  return file
}

/** World axes (Z up): the slide travels along X on floor and wall; vertical puts the motor on top. */
export function mountingFrame(mounting: Mounting): { travel: Vec3; normal: Vec3 } {
  if (mounting === 'floor') return { travel: [1, 0, 0], normal: [0, 0, 1] }
  if (mounting === 'wall') return { travel: [1, 0, 0], normal: [0, -1, 0] }
  return { travel: [0, 0, -1], normal: [0, -1, 0] }
}

export interface ComboPart {
  role: PartRole
  name: string
  transform: Transform
  /** gantry drawing: the axis the part belongs to (a gantry kit: the base axis whose slide it stands on) */
  axis?: 'x' | 'y' | 'z'
}

export interface Combo {
  name: string
  /** assembled STEP text */
  step: string
  parts: ComboPart[]
  /** payload centre of gravity, world mm (slide centre at the start position = origin) */
  cog: Vec3
  slideCentre: Vec3
  /** axis file stroke and the length change applied to reach the ordered stroke */
  axisStroke: number
  stretch: number
  /** the slide centre at the start and the end of the ordered stroke (world mm; single axis drawings) */
  stroke?: { from: Vec3; to: Vec3; length: number }
}

/** Second, parallel axis: `spacing` mm beside the first along the slide's lateral (+y) direction */
export interface TwinAxis {
  spacing: number
  /** true: it has its own kit, gearbox and motor (motor sync); false: driven through a connecting shaft */
  drive: boolean
  /** the connecting shaft (KSK) between the drive shafts, drawn when it has a drawing */
  shaft?: { model: string; length: number; drawing: Drawing<ShaftMeta> }
}

/**
 * Places axis → kit → (gearbox →) motor by their mating frames and writes one STEP assembly. The axis is
 * stretched or shortened from the file's stroke to the ordered stroke when its metadata allows it. A parallel kit
 * is turned about the drive shaft to `options.kitSide`, and the motor about its shaft so its connector points to
 * `connectorSide(options)`. `twin` adds a copy of the axis (and of its drive train) beside it.
 */
export async function buildCombo(
  sel: ComboSelection,
  found: ComboDrawings,
  req: Pick<Requirements, 'mounting' | 'cog'>,
  load: (d: Drawing) => Promise<string>,
  options: ComboOptions = defaultComboOptions,
  twin?: TwinAxis,
): Promise<Combo> {
  const c = await comboParts(sel, found, req, load, options, twin)
  const step = writeStep(assemble(c.name, c.parts, { notices: c.notices }))
  return {
    name: c.name,
    step,
    parts: c.parts.map(({ role, name, transform }) => ({ role, name, transform })),
    cog: c.cog,
    slideCentre: [0, 0, 0],
    axisStroke: c.axisStroke,
    stretch: c.stretch,
    // from the slide as drawn along its travel, or back from the end of the travel (`atEnd`)
    stroke: { from: c.slide.origin, to: add(c.slide.origin, scale(c.slide.up, c.atEnd ? -sel.stroke : sel.stroke)), length: sel.stroke },
  }
}

/** The placed parts of a combination before they are written out (`buildCombo`; the gantry places several). */
export interface ComboParts {
  name: string
  parts: (AssemblyPart & { role: PartRole })[]
  notices: string[]
  cog: Vec3
  axisStroke: number
  stretch: number
  /** world frames of the first axis: its slide surface (origin = slide centre at the start position, axis = slide
   *  normal, up = travel) and its profile's mounting face (middle of its length, axis out of the face, up = travel) */
  slide: Frame
  profile: Frame
  /** world point of the first axis's drive flange (its JSON's drive origin, where `baseLength` is measured from) */
  driveFlange: Vec3
  /** world vectors from each slide's centre (first axis, then a twin's) to its hole pattern centre, where a gantry kit
   *  sits (`slide.pattern`, EGC-TB/BS-KF; zero elsewhere); a twin drawn mirrored has it on the other side */
  patternOffsets: Vec3[]
  /** world vectors from the slide frame (with additional slides the centre of the group) to the main slide, per member
   *  as `patternOffsets`: a gantry kit sits on the main slide only */
  mainOffsets: Vec3[]
  /** mm along the travel (`slide.up`) from the middle of the profile to the slide as drawn: 0 when centred */
  slideOffset: number
  /** the slide drawn at the end of its travel (the file has it there), not at the start */
  atEnd: boolean
}

export async function comboParts(
  sel: ComboSelection,
  found: ComboDrawings,
  req: Pick<Requirements, 'mounting' | 'cog'>,
  load: (d: Drawing) => Promise<string>,
  options: ComboOptions = defaultComboOptions,
  twin?: TwinAxis,
): Promise<ComboParts> {
  if (found.missing.length > 0 || !found.axis || !found.kit || !found.motor) throw new Error('drawings missing')
  const axisMeta = found.axis.meta!
  const kitMeta = found.kit.meta!
  const motorMeta = (found.motor.meta as MotorMeta | null) ?? defaultMotorMeta(sel.motor.maker)
  const shaftTwin = twin && !twin.drive ? (twin.shaft ?? null) : null
  const guide = sel.guide && found.guide ? { ...sel.guide, drawing: found.guide } : null
  const sensors = found.sensors
  const [axisText, kitText, motorText, gearboxText, shaftText, guideText, lugText, bracketText, switchTexts, fixingText] = await Promise.all([
    load(found.axis),
    load(found.kit),
    load(found.motor),
    found.gearbox ? load(found.gearbox) : Promise.resolve(null),
    shaftTwin ? load(shaftTwin.drawing) : Promise.resolve(null),
    guide ? load(guide.drawing) : Promise.resolve(null),
    sensors?.lug ? load(sensors.lug) : Promise.resolve(null),
    sensors?.bracket ? load(sensors.bracket) : Promise.resolve(null),
    sensors ? Promise.all(sensors.switches.map(load)) : Promise.resolve(null),
    sensors?.fixing && sensors.bracket && !sensors.bracket.meta?.screws?.length ? load(sensors.fixing) : Promise.resolve(null),
  ])

  let stretched = parseStep(axisText)
  const stretch = sel.stroke - axisMeta.stroke
  let base = { drive: axisMeta.drive, slide: axisMeta.slide }
  if (stretch !== 0) {
    if (!axisMeta.stretch) throw new Error(`no stretch data for ${found.axis.model}`)
    stretched = stretchPart(stretched, axisMeta.stretch, stretch).file
    // a slide or drive at the moving end moves with it
    base = {
      drive: { ...base.drive, origin: stretchedOrigin(base.drive.origin, axisMeta.stretch, stretch) },
      slide: { ...base.slide, origin: stretchedOrigin(base.slide.origin, axisMeta.stretch, stretch) },
    }
  }
  // the profile's mounting face, its middle moved by half the length change (older JSONs: below the slide)
  const own = axisMeta.profile ?? { origin: [base.slide.origin[0], 0, base.slide.origin[2]] as Vec3, normal: scale(base.slide.normal, -1) }
  const k = axisMeta.stretch?.axis
  const middle: Vec3 =
    k != null && axisMeta.profile ? (own.origin.map((v, i) => (i === k ? v + (axisMeta.stretch!.dir * stretch) / 2 : v)) as Vec3) : own.origin
  // Additional slides beside the slide at the start position, the slide moved inwards when one goes to the end it
  // sits at; the slide frame then sits at the centre of the group (the calc centres the payload on it).
  let mainOffset: Vec3 = [0, 0, 0]
  const extra = sel.extraSlides
  if (extra?.length) {
    const t = base.slide.travel
    const toDrive = Math.sign(dot(sub(base.drive.origin, middle), t)) || 1
    const near = Math.sign(dot(sub(base.slide.origin, middle), t)) || -toDrive
    const shifts = extra.map((s) => (s.side === 'left' ? toDrive : -toDrive) * s.pitch)
    const main = -(shifts.find((d) => Math.sign(d) === near) ?? 0)
    const file: StepFile = { header: stretched.header, entities: new Map(stretched.entities) }
    if ((main === 0 || moveSlide(file, scale(t, main))) && copySlide(file, shifts.map((d) => scale(t, d)))) {
      stretched = file
      const centres = [main, ...shifts.map((d) => main + d)]
      const centre = centres.reduce((a, b) => a + b, 0) / centres.length
      mainOffset = scale(t, main - centre)
      base = { ...base, slide: { ...base.slide, origin: add(base.slide.origin, scale(t, centre)) } }
    }
  }
  // the main slide's centre at the start and the end of its travel (the group travels the stroke less its span); a
  // file with its slide at the end of the travel (EGC-BS: past the profile's middle along `travel`) starts a stroke back
  // (an ESBF's rod end, its `slide`, lies past the body's middle retracted)
  const travelLength = sel.stroke - (extra ?? []).reduce((sum, s) => sum + s.pitch, 0)
  const atEnd = sel.axis.family !== 'ESBF' && dot(sub(base.slide.origin, middle), base.slide.travel) > 0
  const travelStart = add(add(base.slide.origin, mainOffset), scale(base.slide.travel, atEnd ? -travelLength : 0))
  const travelEnd = add(travelStart, scale(base.slide.travel, travelLength))
  // the slide (with additional slides the group) in the middle of the profile, i.e. of its travel, on request; a
  // slide that is no part of its own (Creo exports) stays where the file has it
  let slideOffset = dot(sub(base.slide.origin, middle), base.slide.travel)
  if (options.slideCentred && Math.abs(slideOffset) > 0.01) {
    const file: StepFile = { header: stretched.header, entities: new Map(stretched.entities) }
    if (moveSlide(file, scale(base.slide.travel, -slideOffset))) {
      stretched = file
      base = { ...base, slide: { ...base.slide, origin: sub(base.slide.origin, scale(base.slide.travel, slideOffset)) } }
      slideOffset = 0
    }
  }
  const { slide } = base
  // with a connecting shaft the motor takes the shaft end away from the second axis
  const chosen = turnable(sel.axis) ? options.drive : DRIVE_POSITIONS[0]
  const position = twin && !twin.drive && turnable(sel.axis) ? shaftDrivePosition(axisMeta, req.mounting, chosen) : chosen
  const world = mountingFrame(req.mounting)
  const parallel = sel.kit.type === 'parallel'
  const kitFile = sel.kit.special ? parseStep(kitText) : withoutLooseFasteners(parseStep(kitText), kitMeta)
  placeCoupling(kitFile, kitMeta)
  const gearboxFile = gearboxText ? parseStep(gearboxText) : null
  const motorFile = parseStep(motorText)

  const m = dot(middle, slide.travel)
  /** Reflection across the profile's middle plane: one head onto the other */
  const reflect = (p: Vec3) => sub(p, scale(slide.travel, 2 * (dot(p, slide.travel) - m)))

  /**
   * The axis drawn as the mirror image of the first (EGC-TB-KF, slide standing out to one side), from the real part:
   * turned end for end, its drive at the other head (both heads look alike), so the drive end stays where `at` puts
   * it; turned against the first, the slide goes to the far end of the travel to line up with the first's. `open`
   * is the shaft end at the drive head (motor or connecting shaft); the cover cap there on the other head moves to
   * the open shaft end of the head the drive left (the same side, else the other one).
   */
  function mirrorAxis(at: DrivePosition, open: Frame) {
    const file: StepFile = { header: stretched.header, entities: new Map(stretched.entities) }
    const head: Frame = { ...open, origin: reflect(open.origin) }
    const flip = capsAt(file, open, slide).length > 0
    const n = slide.normal
    const centre = sub(open.origin, scale(open.axis, dot(sub(open.origin, slide.origin), open.axis)))
    const half = (v: Vec3) => sub(scale(n, 2 * dot(v, n)), v)
    const e = file.entities
    let next = nextIdOf(e)
    for (const id of capsAt(file, head, slide)) {
      const body = e.get(id)!
      const [location, z, x] = refs(body)
      const p = reflect(pointOf(e.get(location) ?? '')!)
      const renamed = new Map<number, number>([[location, next]])
      e.set(next++, pointBody(flip ? add(centre, half(sub(p, centre))) : p))
      if (flip)
        for (const old of [z, x]) {
          const d = old == null ? null : pointOf((e.get(old) ?? '').replace(/^DIRECTION/, 'CARTESIAN_POINT'))
          if (old == null || !d) continue
          renamed.set(old, next)
          e.set(next++, directionBody(half(d)))
        }
      e.set(id, mapRefs(body, (r) => renamed.get(r) ?? r))
    }
    const turned = { ...at, otherEnd: !at.otherEnd }
    let slideOrigin = slide.origin
    // a centred slide is in the middle either way round
    if (turned.otherEnd !== position.otherEnd && !(options.slideCentred && slideOffset === 0)) {
      // the slides keep their spacing: the group travels the stroke less its span
      const span = (extra ?? []).reduce((sum, s) => sum + s.pitch, 0)
      const shift = scale(slide.travel, sel.stroke - span)
      if (moveSlide(file, shift)) slideOrigin = add(slide.origin, shift)
    }
    return { file, head, axisToWorld: axisToWorldOf(axisMeta, req.mounting, turned, slideOrigin) }
  }

  /**
   * Axis with its drive train for one drive position and orientation, the slide centre at the origin; `mirror`
   * draws the axis as the first's mirror image (`mirrorAxis`). `reference`: the world direction the first axis's
   * motor end faces; the sides mean the same directions as on the first, so they swap left and right when this
   * motor end faces the other way.
   */
  const train = (at: DrivePosition, orientation: ComboOptions = options, mirror = false, reference?: Vec3) => {
    let drive = at.otherSide ? otherShaftEnd(base.drive, slide) : base.drive
    let file = stretched
    let axisToWorld: Transform
    if (mirror) {
      const mirrored = mirrorAxis(at, drive)
      ;({ file, axisToWorld } = mirrored)
      drive = mirrored.head
    } else {
      if (at.otherSide) {
        // moveCaps edits the entities: a copy, the other axis keeps them
        file = { header: stretched.header, entities: new Map(stretched.entities) }
        moveCaps(file, drive, slide)
      }
      // a head capped on both sides (EGC-HD-TB): the cap over the shaft end the kit goes on comes off
      if (capsAt(file, drive, slide).length) file = withoutCaps(file, drive, slide)
      // axis → world: slide centre at the origin, travel and slide normal by the mounting
      axisToWorld = axisToWorldOf(axisMeta, req.mounting, at, slide.origin)
    }
    let kitToWorld = mate(axisToWorld, drive, kitMeta.axisFace)
    // sides as seen from the motor end: `drive.axis` points out towards the viewer, `drive.up` is the slide side
    const out = rotate(axisToWorld, drive.axis)
    if (reference && dot(out, reference) < 0) orientation = mirrorSides(orientation)
    const up = rotate(axisToWorld, drive.up)
    const right = cross(up, out)
    const sideVector = (side: Side) =>
      side === 'up' ? up : side === 'down' ? scale(up, -1) : side === 'right' ? right : scale(right, -1)
    if (parallel) {
      const offset = sub(apply(kitToWorld, kitMeta.motorFace.origin), apply(kitToWorld, kitMeta.axisFace.origin))
      const radial = sub(offset, scale(out, dot(offset, out)))
      if (Math.hypot(...radial) > 1)
        kitToWorld = turnAbout(kitToWorld, apply(axisToWorld, drive.origin), out, radial, sideVector(orientation.kitSide))
    }
    // the axis's coupling hub meshing with the kit's (its jaws between the kit hub's)
    const hub = axisMeta.coupling
    if (hub && kitMeta.coupling?.count === hub.count && !at.otherSide && !mirror)
      file = turnHub(file, hub, drive, rotate(invert(axisToWorld), rotate(kitToWorld, kitMeta.coupling.jaw)))
    const parts: (AssemblyPart & { role: PartRole })[] = [
      { role: 'axis', name: sel.axisModel, file, transform: axisToWorld },
      { role: 'kit', name: sel.kit.product, file: kitFile, transform: kitToWorld },
    ]
    let motorParent = { transform: kitToWorld, frame: kitMeta.motorFace }
    if (found.gearbox && gearboxFile) {
      const gearboxMeta = found.gearbox.meta!
      const gearboxToWorld = mate(kitToWorld, kitMeta.motorFace, gearboxMeta.output)
      parts.push({ role: 'gearbox', name: sel.gearbox!.model, file: gearboxFile, transform: gearboxToWorld })
      motorParent = { transform: gearboxToWorld, frame: gearboxMeta.input }
    }
    let motorToWorld = mate(motorParent.transform, motorParent.frame, motorMeta.flange)
    const shaft = rotate(motorToWorld, motorMeta.flange.axis)
    const connector = rotate(motorToWorld, motorMeta.connector ?? motorMeta.flange.up)
    // the side across the shaft; behind an angle gearbox the shaft itself can point to that side: the motor keeps its turn
    const side = sideVector(connectorSide(orientation, parallel))
    const target = sub(side, scale(shaft, dot(side, shaft)))
    if (Math.hypot(...target) > 1e-6)
      motorToWorld = turnAbout(motorToWorld, apply(motorToWorld, motorMeta.flange.origin), shaft, connector, target)
    parts.push({ role: 'motor', name: found.motor!.model, file: motorFile, transform: motorToWorld })
    return { parts, drive, axisToWorld, file }
  }

  const first = train(position)
  const { drive } = first
  // facing pair (motor sync): each axis with its drive train turned on its side, the slides towards each other
  const facing = options.twinFacing === true && twin?.drive === true
  const axisToWorld = facing ? facingTurn(first.axisToWorld, req.mounting, 1) : first.axisToWorld

  const parts = first.parts
  const lateral = cross(world.normal, world.travel)
  let name = parts.map((p) => p.name).join(' + ')
  // Guide without drive: the EAGF on the cylinder's front flange (the payload then sits on its yoke plate), or the
  // guide axes beside the axis, their slides level with its slide at the start position, lengthened to the stroke
  let payloadAt: Vec3 = [0, 0, 0]
  if (guide && guideText) {
    const meta = guide.drawing.meta!
    let file = parseStep(guideText)
    const d = guide.stroke - meta.stroke
    if (d !== 0 && meta.stretch) file = stretchPart(file, meta.stretch, d).file
    const at = (p: Vec3) => (d !== 0 && meta.stretch ? stretchedOrigin(p, meta.stretch, d) : p)
    if (meta.mount && meta.yoke && axisMeta.front) {
      const f = axisMeta.front
      // the EAGF's `up` lies in its rods' plane: on the slide normal (`front.up`) they sit above and below
      const front = {
        ...f,
        origin: stretch !== 0 && axisMeta.stretch ? stretchedOrigin(f.origin, axisMeta.stretch, stretch) : f.origin,
        up: options.guideRods === 'upDown' ? f.up : cross(f.axis, f.up),
      }
      const transform = mate(axisToWorld, front, { ...meta.mount, origin: at(meta.mount.origin) })
      parts.push({ role: 'guide', name: guide.model, file, transform })
      payloadAt = apply(transform, at(meta.yoke))
      name += ` + ${guide.model}`
    } else if (meta.slide) {
      const g = meta.slide
      // the guide profile runs from its slide the way the axis profile does (EGC/ELGD-BS files travel towards the
      // shorter side: the guide's travel would turn it end for end)
      const along = (s: { origin: Vec3; travel: Vec3 }, profile?: { origin: Vec3 }) =>
        profile && dot(sub(profile.origin, s.origin), s.travel) < 0 ? -1 : 1
      const up = scale(slide.travel, along(axisMeta.slide, axisMeta.profile) * along(g, meta.profile))
      const level = mate(axisToWorld, { origin: slide.origin, axis: slide.normal, up }, { origin: at(g.origin), axis: g.normal, up: g.travel })
      guide.offsets.forEach((o, i) =>
        parts.push({
          role: 'guide',
          name: guide.offsets.length > 1 ? `${guide.model} (${i + 1})` : guide.model,
          file,
          transform: { ...level, t: add(level.t, scale(lateral, o)) },
        }),
      )
      name += ` + ${guide.offsets.length} × ${guide.model}`
    }
  }
  // Position sensing on the first axis: the switch lug on the main slide's side face as drawn, the proximity switches
  // in the sensor slot (`switchPlacements`); without a lug (ESBF) the switches at fixed places on the body
  // (`bodySwitchPlacements`), each in a bracket hooked onto the profile's side
  if (sensors && switchTexts && axisMeta.sensor) {
    const turn = options.sensorSide ? sensorSides(axisMeta)?.turn(options.sensorSide) : undefined
    const filed = axisMeta.sensor
    const seats = turn
      ? { ...filed, slot: turn(filed.slot), ...(filed.lug ? { lug: turn(filed.lug) } : {}), ...(filed.bracket ? { bracket: turn(filed.bracket) } : {}) }
      : filed
    const from =(seat: Frame, slideAt: Vec3, up = seat.up): Frame => ({ ...seat, origin: add(slideAt, sub(seat.origin, axisMeta.slide.origin)), up })
    const files = new Map<string, StepFile>()
    const switches = sel.sensing!.switches
    const lengths = sensors.switches.map((d) => d.meta!.length ?? 0)
    let slots: Frame[]
    if (sensors.lug && lugText && seats.lug) {
      // with an Omron sensor bracket the lug may be fixed otherwise (EAPM-E24-60-SLS on its spacers)
      const bracket = sensors.bracket?.meta && bracketText ? sensors.bracket.meta : null
      const lugMeta = { ...sensors.lug.meta!, ...(bracket ? sensors.lug.meta!.withBracket : {}) }
      let lugFile = withoutParts(parseStep(lugText), lugMeta.without)
      for (const name of lugMeta.move?.parts ?? []) placePart(lugFile, name, { r: identity.r, t: lugMeta.move!.by })
      parts.push({ role: 'sensor', name: sel.sensing!.lug!.model, file: lugFile, transform: mate(first.axisToWorld, from(seats.lug, add(slide.origin, mainOffset)), lugMeta.seat) })
      const travel = dot(sub(travelEnd, travelStart), base.slide.travel)
      // Omron: each sensor on its bracket, placed as one unit: from the bracket's end on the sensor side (its `up`
      // end), whose optical axis is the switching point, the bracket's length long
      const beamFrom = (i: number) => {
        const { seat, slot, length = 0 } = bracket!
        const beam = add(slot!.origin, scale(slot!.up, sensors.switches[i].meta!.beam ?? 0))
        return length / 2 - Math.abs(dot(sub(beam, seat.origin), seat.up))
      }
      const placed = switchPlacements(
        switches.map((s) => s.role),
        travel,
        lugMeta.edge ?? 0,
        sensors.switches.map((d, i) => (bracket ? beamFrom(i) : (d.meta!.switchPoint ?? 0))),
        bracket ? lengths.map(() => bracket.length ?? 0) : lengths,
        bracket != null,
        !!seats.limitsInwards,
      )
      // the lug's middle off the slide centre along the travel (ELGD-BS slides), which the switches follow
      const lugShift = dot(sub(seats.lug.origin, axisMeta.slide.origin), axisMeta.slide.travel)
      slots = placed.map((p, i) => {
        if (!bracket) return from(seats.slot, add(travelStart, scale(base.slide.travel, p.end + lugShift)), scale(seats.slot.up, p.facing))
        // the bracket's slot nuts in its slot, upright (its seat's `up` × `axis` downwards, the bracket cannot be
        // turned end for end), its centre half its length behind `end`; the sensor on the hole pair at the end
        // facing `p.facing`: the file's `slot` or the other one, its screws (`screws`, filed at `slot`) moved along
        const nuts = seats.bracket ?? seats.slot
        const up = cross(axisMeta.slide.normal, nuts.axis)
        const centre = p.end + lugShift - (p.facing * (bracket.length ?? 0)) / 2
        const seat = from(nuts, add(travelStart, scale(base.slide.travel, centre)), up)
        const slot = bracket.slot!
        const along = dot(sub(slot.origin, bracket.seat.origin), bracket.seat.up)
        const turned = dot(up, axisMeta.slide.travel) * p.facing * along < 0
        const key = `${sensors.bracket!.path}#${turned}`
        let file = files.get(key)
        if (!file) {
          file = parseStep(bracketText!)
          if (turned) for (const name of bracket.screws ?? []) placePart(file, name, { r: identity.r, t: scale(bracket.seat.up, -2 * along) })
          files.set(key, file)
        }
        parts.push({ role: 'sensor', name: `${sel.sensing!.bracket!.model} (${SWITCH_NAMES[switches[i].role]})`, file, transform: mate(first.axisToWorld, seat, bracket.seat) })
        const onBracket = mate(identity, seat, bracket.seat)
        const own = turned ? { ...slot, origin: sub(slot.origin, scale(bracket.seat.up, 2 * along)), up: scale(slot.up, -1) } : slot
        return { origin: apply(onBracket, own.origin), axis: rotate(onBracket, own.axis), up: rotate(onBracket, own.up) }
      })
    } else {
      // the body from its front face (the slot frame) to the drive end, after the length change
      const u = seats.slot.up
      const body = dot(sub(seats.slot.origin, base.drive.origin), u)
      const bracket = sensors.bracket?.meta
      // switches side by side are a bracket apart
      const pitch = lengths.map((l) => Math.max(l, bracket?.length ?? 0))
      slots = bodySwitchPlacements(
        switches.map((s) => s.role),
        body,
        lengths,
        pitch,
        sel.axis.sensorArea ?? [0, 0],
      ).map((p, i) => {
        const up = scale(u, p.facing)
        const frame = { ...seats.slot, origin: sub(seats.slot.origin, scale(u, p.end)), up }
        if (!bracket || !bracketText) return frame
        // the bracket centred on its switch, its hook on the profile's side: the profile is square, so the side lies
        // as far from the rod axis (the drive frame's line) as the top face
        const side = cross(seats.slot.axis, u)
        const half = dot(sub(seats.slot.origin, base.drive.origin), seats.slot.axis)
        const centre = sub(frame.origin, scale(up, lengths[i] / 2))
        const seat = { ...seats.slot, origin: add(centre, scale(side, half)), up: u }
        const file = files.get(sensors.bracket!.path) ?? parseStep(bracketText)
        files.set(sensors.bracket!.path, file)
        parts.push({ role: 'sensor', name: `${sel.sensing!.bracket!.model} (${SWITCH_NAMES[switches[i].role]})`, file, transform: mate(first.axisToWorld, seat, bracket.seat) })
        // the switch in the bracket's slot, centred on it
        const inSlot = apply(mate(identity, seat, bracket.seat), bracket.slot!.origin)
        return { ...frame, origin: add(inSlot, scale(up, lengths[i] / 2)) }
      })
    }
    switches.forEach((s, i) => {
      const drawing = sensors.switches[i]
      const file = files.get(drawing.path) ?? trimmed(withoutParts(parseStep(switchTexts[i]), drawing.meta!.without), drawing.meta!.trim)
      files.set(drawing.path, file)
      const transform = mate(first.axisToWorld, slots[i], drawing.meta!.seat)
      parts.push({ role: 'sensor', name: `${s.part.model} (${SWITCH_NAMES[s.role]})`, file, transform })
      // its fixing screws on its ears, where the bracket brings none
      const fixing = drawing.meta!.fixing
      if (fixing && fixingText && sensors.fixing?.meta) {
        const screw = files.get(sensors.fixing.path) ?? parseStep(fixingText)
        files.set(sensors.fixing.path, screw)
        for (const at of fixing.at)
          parts.push({ role: 'sensor', name: `${sensors.fixing.model} (${SWITCH_NAMES[s.role]})`, file: screw, transform: mate(transform, { origin: at, axis: fixing.axis, up: fixing.up }, sensors.fixing.meta.seat) })
      }
    })
    name += ` + ${sel.sensing!.lug ? `${sel.sensing!.lug.model} + ` : ''}${switches.length} × ${[...new Set(switches.map((s) => s.part.model))].join(' / ')}${sensors.bracket ? ` + ${switches.length} × ${sel.sensing!.bracket!.model}` : ''}`
  }
  // Second axis of a twin arrangement at +y (the COG's lateral direction), by default the mirror image of the
  // first (`mirroredDrive`; a slide standing out to one side drawn mirrored, `mirrorAxis`), with its own drive train
  // (drive position `options.twinDrive`, kit side and connector `twinOrientation`) when it has a motor
  if (twin) {
    const shift = scale(lateral, twin.spacing)
    const mirror = turnable(sel.axis) && axisMeta.slide.front != null
    const twinAt = turnable(sel.axis) ? (options.twinDrive ?? mirroredDrive(axisMeta, position)) : position
    // connecting shaft: the axis alone, its shaft end facing the first open
    const shaftMirror = () => {
      const { file, axisToWorld: transform } = mirrorAxis(position, otherShaftEnd(drive, slide))
      return [{ role: 'axis' as const, name: sel.axisModel, file, transform }]
    }
    const second = twin.drive
      ? train(twinAt, twinOrientation(options), mirror, rotate(first.axisToWorld, drive.axis)).parts
      : mirror
        ? shaftMirror()
        : parts
    const copies = second
      .filter((p) => twin.drive || p.role === 'axis')
      .map((p) => {
        const shifted = { ...p.transform, t: add(p.transform.t, shift) }
        return { ...p, name: `${p.name} (2)`, transform: facing ? facingTurn(shifted, req.mounting, -1, shift) : shifted }
      })
    if (facing) for (const p of parts) p.transform = facingTurn(p.transform, req.mounting, 1)
    parts.push(...copies)
    name += ' (2 axes)'
    // Connecting shaft from the first axis's free shaft end (cover cap taken off) to the second axis's motor-side
    // end, which faces it uncapped; the tube is lengthened from the file's nominal length to the ordered one.
    if (shaftTwin && shaftText) {
      const meta = shaftTwin.drawing.meta!
      const end = otherShaftEnd(drive, slide)
      parts[0] = { ...parts[0], file: withoutCaps(first.file, end, slide) }
      let shaftFile = parseStep(shaftText)
      if (shaftTwin.length !== meta.length) shaftFile = stretchPart(shaftFile, meta.stretch, shaftTwin.length - meta.length).file
      parts.push({ role: 'shaft', name: shaftTwin.model, file: shaftFile, transform: mate(axisToWorld, end, meta.end) })
      name += ` + ${shaftTwin.model}`
    }
  }
  // the slide hole pattern beside the slide centre (EGC-TB/BS-KF), turned with the first axis; a twin drawn mirrored
  // (turned end for end about its slide normal) has it on the other side, a plain copy on the same
  const toPattern = axisMeta.slide.pattern ? rotate(axisToWorld, sub(axisMeta.slide.pattern, axisMeta.slide.origin)) : ([0, 0, 0] as Vec3)
  const toMain = rotate(axisToWorld, mainOffset)
  const mirrored = twin != null && turnable(sel.axis) && axisMeta.slide.front != null
  const patternOffsets: Vec3[] = [toPattern, ...(twin ? [mirrored ? scale(toPattern, -1) : toPattern] : [])]
  const mainOffsets: Vec3[] = [toMain, ...(twin ? [mirrored ? scale(toMain, -1) : toMain] : [])]
  // COG in the first slide's frame (x travel, y lateral, z normal); a facing pair turns it with the slide, y then
  // measured from the slide centre again (both slides at the same height), not from the arrangement's centre
  const cogY = facing ? req.cog.y - twin!.spacing / 2 : req.cog.y
  const cogOnSlide = add(payloadAt, add(add(scale(world.travel, req.cog.x), scale(lateral, cogY)), scale(world.normal, req.cog.z)))
  const cog = facing ? apply(facingTurn(identity, req.mounting, 1), cogOnSlide) : cogOnSlide
  const notices = [...new Set([axisText, kitText, motorText, gearboxText, shaftText, guideText, lugText, bracketText, ...(switchTexts ?? [])].flatMap((t) => (t && sourceNotice(t)) || []))]
  return {
    name,
    parts,
    notices,
    cog,
    axisStroke: axisMeta.stroke,
    stretch,
    slide: { origin: [0, 0, 0], axis: rotate(axisToWorld, slide.normal), up: rotate(axisToWorld, slide.travel) },
    profile: { origin: apply(axisToWorld, middle), axis: rotate(axisToWorld, own.normal), up: rotate(axisToWorld, slide.travel) },
    driveFlange: apply(axisToWorld, axisMeta.drive.origin),
    patternOffsets,
    mainOffsets,
    slideOffset,
    atEnd: atEnd && !(options.slideCentred && slideOffset === 0),
  }
}
