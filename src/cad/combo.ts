import type { Mounting, Requirements } from '../calc/types'
import type { Axis, Gearbox, Kit, Motor } from '../data/types'
import { assemble, sourceNotice, type AssemblyPart } from './assemble'
import {
  axisDrawingsFor,
  gearboxDrawingFor,
  kitDrawingFor,
  motorDrawingFor,
  type AxisMeta,
  type Drawing,
  type GearboxMeta,
  type KitMeta,
  type MotorMeta,
  type ShaftMeta,
} from './drawings'
import { add, apply, cross, dot, identity, mate, rotate, scale, sub, turnAbout, type Frame, type Transform } from './geometry'
import { directionBody, mapRefs, nextIdOf, parseStep, pointBody, pointOf, refs, typeOf, writeStep, type StepFile, type Vec3 } from './step'
import { stretchedOrigin, stretchPart } from './stretch'
import { definitionByName, placementIdsOf, shapeOf } from './structure'

export type PartRole = 'axis' | 'kit' | 'gearbox' | 'motor' | 'shaft' | 'adapter'

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
  missing: PartRole[]
}

export function comboDrawings(sel: ComboSelection, all?: Drawing[]): ComboDrawings {
  const axis = axisDrawingsFor(sel.axis, sel.stroke, all)[0] ?? null
  const motor = motorDrawingFor(sel.motor, all)
  const gearbox = sel.gearbox ? gearboxDrawingFor(sel.gearbox, all) : null
  const kit = kitDrawingFor(sel.kit, all)
  const missing: PartRole[] = []
  if (!axis) missing.push('axis')
  if (!kit?.meta) missing.push('kit')
  if (sel.gearbox && !gearbox?.meta) missing.push('gearbox')
  if (!motor) missing.push('motor')
  return { axis, motor: motor?.drawing ?? null, motorOtherOptions: motor?.otherOptions ?? false, motorSameOutline: motor?.sameOutline ?? false, gearbox, kit, missing }
}

// Festo convention (flange at z = 0, shaft +z, connector +y); Mitsubishi's flange motors have their connectors at −y
const defaultMotorMeta = (maker: string): MotorMeta => ({
  flange: { origin: [0, 0, 0], axis: [0, 0, -1], up: [0, 1, 0] },
  ...(maker === 'Mitsubishi' ? { connector: [0, -1, 0] } : {}),
})

/** Direction seen from the motor end of the axis, looking along the axis with the slide surface up. */
export type Side = 'up' | 'down' | 'left' | 'right'
export const SIDES: readonly Side[] = ['up', 'down', 'left', 'right']

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

/** Moves the slide part by `shift` (file mm; new points, the old ones may be shared). False when it is no part of its own. */
function moveSlide(file: StepFile, shift: Vec3): boolean {
  const pd = definitionByName(file, SLIDE_PART)
  const rep = pd != null ? shapeOf(file, pd) : null
  const placements = rep != null ? placementIdsOf(file, rep) : []
  const e = file.entities
  let next = nextIdOf(e)
  for (const id of placements) {
    const body = e.get(id)!
    const location = pointOf(e.get(refs(body)[0]) ?? '')
    if (!location) return false
    e.set(next, pointBody(add(location, shift)))
    e.set(id, mapRefs(body, (r) => (r === refs(body)[0] ? next : r)))
    next++
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

/** Shaft cover caps (CUP) at the drive head on the side `end` faces */
function capsAt(file: StepFile, end: Frame, slide: AxisMeta['slide']) {
  const pd = definitionByName(file, '(CUP)')
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
  if (!caps.length) return file
  const e = new Map(file.entities)
  const find = (test: (body: string) => boolean) => [...e].find(([, b]) => test(b))?.[0]
  for (const placement of caps) {
    // the instance: transformation → relationship → context dependent shape → its shape → the assembly usage
    const idt = find((b) => typeOf(b) === 'ITEM_DEFINED_TRANSFORMATION' && refs(b)[1] === placement)
    if (idt == null) continue
    const rel = find((b) => new RegExp(String.raw`REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION\s*\(\s*#${idt}\s*\)`).test(b))
    const cdsr = rel == null ? undefined : find((b) => typeOf(b) === 'CONTEXT_DEPENDENT_SHAPE_REPRESENTATION' && refs(b)[0] === rel)
    const pds = cdsr == null ? undefined : refs(e.get(cdsr)!)[1]
    const nauo = pds == null ? undefined : refs(e.get(pds) ?? '')[0]
    for (const id of [cdsr, rel, idt, pds, nauo]) if (id != null) e.delete(id)
  }
  return { header: file.header, entities: e }
}

/**
 * Moves the shaft cover caps (CUP) off the drive's new shaft end to the end it left: each cap at the drive head on
 * the new side turns half a turn about the head's vertical line through the shaft. Heads capped on both sides
 * (EGC-HD-TB) keep their caps.
 */
function moveCaps(file: StepFile, drive: Frame, slide: AxisMeta['slide']) {
  const pd = definitionByName(file, '(CUP)')
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
export function assemblyWarnings(options: ComboOptions, parallel: boolean): string[] {
  if (!parallel) return []
  const warnings: string[] = []
  if (connectorSide(options, parallel) === opposite[options.kitSide])
    warnings.push('모터 커넥터가 축 쪽을 향합니다. 간섭을 확인하세요.')
  if (options.kitSide === 'up')
    warnings.push('모터가 슬라이드 쪽에 있어 슬라이드·부하와 간섭할 수 있으므로 사용 가능한 스트로크가 줄어들 수 있습니다.')
  return warnings
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
  const [axisText, kitText, motorText, gearboxText, shaftText] = await Promise.all([
    load(found.axis),
    load(found.kit),
    load(found.motor),
    found.gearbox ? load(found.gearbox) : Promise.resolve(null),
    shaftTwin ? load(shaftTwin.drawing) : Promise.resolve(null),
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
  const { slide } = base
  // with a connecting shaft the motor takes the shaft end away from the second axis
  const chosen = turnable(sel.axis) ? options.drive : DRIVE_POSITIONS[0]
  const position = twin && !twin.drive && turnable(sel.axis) ? shaftDrivePosition(axisMeta, req.mounting, chosen) : chosen
  const world = mountingFrame(req.mounting)
  const parallel = sel.kit.type === 'parallel'
  const kitFile = parseStep(kitText)
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
    if (turned.otherEnd !== position.otherEnd) {
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
  const cogOnSlide = add(add(scale(world.travel, req.cog.x), scale(lateral, cogY)), scale(world.normal, req.cog.z))
  const cog = facing ? apply(facingTurn(identity, req.mounting, 1), cogOnSlide) : cogOnSlide
  const notices = [...new Set([axisText, kitText, motorText, gearboxText, shaftText].flatMap((t) => (t && sourceNotice(t)) || []))]
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
  }
}
