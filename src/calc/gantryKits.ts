// Gantry kits: the Festo part joining a carried axis's profile to the slide of the axis below it (EHAM angle and
// adapter kits, EAHF-E24 profile mountings), from the axis data sheets' combination tables (data/adapters); where no
// Festo kit exists (EGC), a custom angle bracket or plate (data/adapters/Custom, made to order).
import type { Axis, AxisAdapter, AdapterAxis } from '../data/types'
import { axisFrame, baseParallel, gantryBase, zAcrossTwinY, type GantryAxis, type GantryInputs, type Vec } from './gantry'
import { guidePositions, type Status } from './types'

/** One joint of the gantry: `carried` sits on the slide(s) of `base` */
export interface GantryJoint {
  base: GantryAxis
  carried: GantryAxis
  /** the geometry the mountings need: angle (slides facing across each other), plate (facing the same way), beam (a
   *  custom cross beam between the angle kits of two base axes, `beam`) */
  kind: 'angle' | 'plate' | 'beam' | null
  /** the kit on the first base slide (`kits[0]`) */
  kit: AxisAdapter | null
  /** one kit per base slide (two X axes carry the Y axis at both ends), in slide order (first axis at −l); angle
   *  kits take the hand whose wall reaches towards the carried axis (`kitHand`), so two X axes get a mirrored pair */
  kits: AxisAdapter[]
  quantity: number
  /** world mm from the base axis's (arrangement) centre: the carried axis's mounting point (body centre) and the
   *  kits' centre. With kit fit data the carried axis sits where the kit holds it (`aligned`, `placement`), else
   *  at the entered offset; the kits sit on the base slide(s) */
  offset: Vec
  kitAt: Vec
  aligned: boolean
  /** the kit's pins and screws hold the carried axis at its drive end (ELGT): `flange` is the drive flange's
   *  position along the carried travel (world mm from the base centre), `driveSign` the end the drive is at (+1:
   *  +t, as the calc otherwise assumes; −1 when the kit puts it at −t) */
  pinned: boolean
  flange: number | null
  driveSign: 1 | -1
  /** two base slides: the carried axis is held at the first, the second kit clamps its profile with profile
   *  mountings anywhere along the slot (`AdapterAxis.clamp`), so any spacing fits at which the kits are clear and the
   *  profile slot covers all its mountings. `mismatch` (mm): how far the entered base spacing is off the fitting one;
   *  `spacing` the base spacing that fits (nearest the entered one; null when none), `clear` the smallest base
   *  spacing at which the two kits' walls do not collide */
  span?: { mismatch: number; spacing: number | null; clear: number }
  /** two base slides: the kits' walls reaching towards each other overlap at this spacing */
  interference: boolean
  /** two base slides: profile mountings ordered for the second kit on top of it (EHAM-AK-L9: EAHF-L2-45-P;
   *  quantity for that kit, `mass` kg for all of them) */
  mountings?: { model: string; partNumber: string; quantity: number; mass: number }
  /** a custom cross beam (data/adapters/Custom) bolted between the two kits in place of the carried profile, the base
   *  spacing kept: carrying the Y axis on its front face, or the Z axis on an EHAM-MA plate (`plate`) on its pad */
  beam?: GantryBeam
  status: Status
  /** Korean source text with `{name}` placeholders */
  note: string
  noteArgs?: Record<string, string | number>
}

/** A custom cross beam in a joint */
export interface GantryBeam {
  bracket: AxisAdapter
  /** mm, from the base spacing D: L = D − 2 · end */
  length: number
  /** z beams: the Festo adapter plate on the pad holding the Z axis */
  plate: AxisAdapter | null
  /** mm along the beam from its centre (towards the second base slide): the carried axis's mounting point (Y: its
   *  centre, drive flange to far end; Z: the pad centre) */
  at: number
}

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/**
 * Lateral positions (mm along the base slide's l, from the arrangement centre) of the base axis members carrying
 * the next axis: two base axes (X, or Y in yz) at ∓spacing/2, a base axis with LM guides where the layout puts the
 * axis, else 0.
 */
function baseSlides(g: GantryInputs, base: GantryAxis): number[] {
  const p = baseParallel(g)
  if (base !== gantryBase(g.config) || p.mode === 'single' || !(p.spacing > 0)) return [0]
  if (p.mode === 'guides') {
    const { positions, axis } = guidePositions(p)
    return [positions[axis] * p.spacing]
  }
  return [-p.spacing / 2, p.spacing / 2]
}

/**
 * The hand of an angle kit on a base slide at lateral position `at`. The mirror-image versions differ in the side
 * the wall reaches to from the foot on the base slide (EHAM-AK assembly instructions, product variants): seen
 * facing the carried slide, …-ML reaches to the right (along n_base × n_carried), …-MR to the left. The wall goes
 * towards the carried axis's mounting point (between two X axes: inwards); on the slide itself, left.
 */
export function kitHand(g: GantryInputs, base: GantryAxis, carried: GantryAxis, at: number): 'left' | 'right' {
  const b = axisFrame(g, base)
  const c = axisFrame(g, carried)
  const o = carried === 'z' ? g.offsets.yz : g.offsets.xy
  return handFor(b.n, c.n, c.t, dot([o.x, o.y, o.z], c.t) - at * dot(b.l, c.t))
}

/** The hand of an angle kit on a slide facing `n` whose wall reaches `towards` (sign) along `t`, holding a profile
 *  whose slide faces `carried` */
function handFor(n: number[], carried: number[], t: number[], towards: number): 'left' | 'right' {
  const left = dot(cross(n, carried), t)
  if (Math.abs(towards) < 1e-6) return 'left'
  return towards * left > 0 ? 'left' : 'right'
}

/**
 * The joint geometry for the two mountings: plate when both slides face the same way (Y on X floor-on-floor, Z on a
 * wall-mounted Y), angle when the carried slide faces across the base slide's normal and the carried axis travels
 * across that normal (X on the floor, Y on its side); else null (Z on a floor-mounted Y needs a custom bracket).
 */
export function jointKind(g: GantryInputs, base: GantryAxis, carried: GantryAxis): GantryJoint['kind'] {
  const b = axisFrame(g, base)
  const c = axisFrame(g, carried)
  if (dot(b.n, c.n) > 0.99) return 'plate'
  if (Math.abs(dot(b.n, c.n)) < 1e-6 && Math.abs(dot(b.n, c.t)) < 1e-6) return 'angle'
  return null
}

const fits = (list: AdapterAxis[], axis: Axis) =>
  list.find(
    // variant: "" or null for the standard version
    (x) => x.family === axis.family && (x.variant || null) === (axis.variant || null) && x.size === axis.size && x.drive === axis.drive,
  )

/**
 * Where the carried axis and the kits sit (see `GantryJoint.offset`), from the kit's fit for the carried axis
 * (`AdapterAxis.end`, assembly instructions): along the body direction from the first base slide (angle kits: the
 * wall's reach; plates: from the drive end at +t, as the calc takes it) the near end at `end`, the body beyond. A
 * pinned axis has its drive there. `length` (mm, drive flange to far end) null when unknown: the carried axis then
 * stays at the entered offset.
 */
function placement(
  g: GantryInputs,
  base: GantryAxis,
  carried: GantryAxis,
  carriedAxis: Axis,
  kits: AxisAdapter[],
  slides: number[],
  length: number | null,
): Pick<GantryJoint, 'offset' | 'kitAt' | 'aligned' | 'pinned' | 'flange' | 'driveSign' | 'span' | 'interference' | 'mountings'> & { short?: boolean } {
  const b = axisFrame(g, base)
  const c = axisFrame(g, carried)
  const o = carried === 'z' ? g.offsets.yz : g.offsets.xy
  const v = [o.x, o.y, o.z]
  const along = dot(v, c.t)
  const at = slides.reduce((s, x) => s + x, 0) / slides.length
  const across = v.map((x, i) => x - along * c.t[i])
  const vec = (w: number[]): Vec => ({ x: w[0] + 0, y: w[1] + 0, z: w[2] + 0 })
  const kitAt = vec(across.map((x, i) => x + at * b.l[i]))
  const fit = kits.length ? fits(kits[0].carried, carriedAxis) : undefined
  const free = { offset: o, kitAt, aligned: false, pinned: false, flange: null, driveSign: 1 as const, interference: false }
  if (!length || !fit || fit.end == null || (kits[0].joint === 'angle' && kits.some((k) => !k.hand))) return free
  // the body's direction along the carried travel (angle kits: the wall's reach), the foot's position on it
  const body = (k: AxisAdapter) => (k.joint === 'plate' ? -1 : (k.hand === 'left' ? 1 : -1) * Math.sign(dot(cross(b.n, c.n), c.t)))
  const foot = (i: number) => slides[i] * dot(b.l, c.t)
  const r0 = body(kits[0])
  const near = foot(0) + r0 * fit.end
  const centre = near + (r0 * length) / 2
  const pinned = !!fit.pinned
  const placed = {
    offset: vec(across.map((x, i) => x + centre * c.t[i])),
    kitAt,
    aligned: true,
    pinned,
    flange: pinned ? near : null,
    // pinned: the drive end is the near one, opposite the body
    driveSign: (pinned ? -r0 : 1) as 1 | -1,
    interference: false,
  }
  if (kits.length < 2 || !fit.clamp) return placed
  const d = r0 * (foot(1) - foot(0))
  const spacing = Math.abs(slides[1] - slides[0])
  // the mirrored walls reach towards each other: they collide below twice their reach (2 mm clearance)
  const clear = 2 * Math.max(...kits.map((k) => k.wall?.[1] ?? 0)) + 2
  const interference = spacing < clear
  // the second kit (mirrored) clamps the profile with its profile mountings, anywhere along it: every mounting under
  // the profile slot, so the slot (far end less the end head) reaches past the farthest one, d − span[0]
  const { span, endCap, mountings: m } = fit.clamp
  const reach = fit.end + length - endCap + span[0]
  const fitting = reach >= clear ? Math.min(Math.max(d, clear), reach) : null
  return {
    ...placed,
    span: { mismatch: d - (fitting ?? d), spacing: fitting, clear },
    interference,
    ...(m && { mountings: { model: m.model, partNumber: m.partNumber, quantity: m.quantity, mass: m.quantity * m.mass } }),
    short: d > reach,
  }
}

/**
 * The kit for a joint: the data's kits of that geometry fitting both axes (Festo kits; custom brackets only when no
 * Festo kit fits), the one for the carried stroke first, the left-hand version of mirror-image pairs. Warns when the base axis needs the long slide, the carried stroke is out
 * of the kit's range, or no kit fits.
 */
export function gantryJoint(
  g: GantryInputs,
  base: GantryAxis,
  carried: GantryAxis,
  baseAxis: Axis,
  carriedAxis: Axis,
  carriedStroke: number,
  adapters: AxisAdapter[],
  carriedLength: number | null = null,
): GantryJoint {
  const slides = baseSlides(g, base)
  // Z across two floor-mounted base axes: no Festo kit, the custom Z beam when the data has one
  if (carried === 'z' && slides.length === 2 && zAcrossTwinY(g) && g.zMode === 'slide') {
    const bracket = beamBracketFor(adapters, baseAxis, carriedAxis, 'z')
    if (bracket) return beamJoint(g, base, carried, carriedAxis, carriedStroke, adapters, slides, carriedLength, bracket)
  }
  const joint = pickJoint(g, base, carried, baseAxis, carriedAxis, carriedStroke, adapters, slides)
  const { short, ...place } = placement(g, base, carried, carriedAxis, joint.kits, slides, carriedLength)
  const span = place.span
  // two base axes carrying the next on pinned angle kits, too far apart for it: the custom Y beam (`wantsBeam`)
  if (joint.status === 'ok' && joint.kind === 'angle' && span && place.pinned && joint.kits.length === 2) {
    const bracket = beamBracketFor(adapters, baseAxis, carriedAxis, 'y')
    if (bracket && wantsBeam(span, Math.abs(slides[1] - slides[0])))
      return beamJoint(g, base, carried, carriedAxis, carriedStroke, adapters, slides, carriedLength, bracket)
  }
  const args = {
    axis: carried.toUpperCase(),
    base: base.toUpperCase(),
    spacing: Math.round((span?.spacing ?? 0) * 10) / 10,
    clear: Math.round((span?.clear ?? 0) * 10) / 10,
  }
  const warn = (note: string) => ({ ...joint, ...place, status: 'warn' as const, note, noteArgs: args })
  if (joint.status === 'ok' && span) {
    // the kits colliding, then the carried axis not reaching the second kit's profile mountings
    if (span.spacing == null)
      return warn(
        place.interference
          ? '두 {base}축의 조합 키트가 서로 겹칩니다(간섭). {base}축 간격은 {clear} mm 이상이어야 하는데 그 간격에서는 {axis}축이 두 번째 키트에 맞게 닿지 않습니다. 더 긴 {axis}축 스트로크가 필요합니다.'
          : '{axis}축이 짧아 두 번째 {base}축 키트에 맞는 간격이 없습니다. 더 긴 {axis}축 스트로크가 필요합니다.',
      )
    if (place.interference) return warn('두 {base}축의 조합 키트가 서로 겹칩니다(간섭). {base}축 간격을 {spacing} mm로 하면 겹치지 않고 맞습니다.')
    if (short)
      return warn(
        joint.kit?.custom
          ? '{axis}축이 두 번째 {base}축 브래킷의 슬롯 너트 나사를 모두 지나 벽 뒤까지 닿지 않습니다. {base}축 간격을 {spacing} mm로 하면 맞습니다.'
          : '{axis}축이 두 번째 {base}축 키트의 프로파일 마운팅(EAHF)까지 모두 닿지 않습니다. {base}축 간격을 {spacing} mm로 하면 맞습니다.',
      )
  }
  return { ...joint, ...place }
}

function pickJoint(
  g: GantryInputs,
  base: GantryAxis,
  carried: GantryAxis,
  baseAxis: Axis,
  carriedAxis: Axis,
  carriedStroke: number,
  adapters: AxisAdapter[],
  slides: number[],
): Omit<GantryJoint, 'offset' | 'kitAt' | 'aligned' | 'pinned' | 'flange' | 'driveSign' | 'interference'> {
  const quantity = slides.length
  const pair = `${base.toUpperCase()}–${carried.toUpperCase()}`
  if (carried === 'z' && g.zMode === 'profile')
    return { base, carried, kind: null, kit: null, kits: [], quantity, status: 'warn', note: '프로파일 이동형 Z축용 조합 키트 데이터가 없습니다. 장착 부품을 별도로 준비하세요.' }
  const kind = jointKind(g, base, carried)
  if (!kind)
    return {
      base,
      carried,
      kind,
      kit: null,
      kits: [],
      quantity,
      status: 'warn',
      note: '{pair}: 이 설치 방향 조합에 맞는 Festo 조합 키트가 없습니다. 장착 브래킷을 별도로 설계하세요.',
      noteArgs: { pair },
    }
  const inRange = (k: AxisAdapter) => !k.carriedStroke || (carriedStroke >= k.carriedStroke[0] && carriedStroke <= k.carriedStroke[1])
  const fitting = adapters.filter((k) => k.joint === kind && fits(k.base, baseAxis) && fits(k.carried, carriedAxis))
  // Festo kits first; a custom angle bracket or plate (data/adapters/Custom, made to order: EGC) only where no Festo kit
  // fits (custom cross beams have their own joint, `beamJoint`)
  const festo = fitting.filter((k) => !k.custom)
  const candidates = (festo.length ? festo : fitting.filter((k) => k.custom)).sort(
    (a, b) => Number(inRange(b)) - Number(inRange(a)) || Number(b.hand !== 'right') - Number(a.hand !== 'right'),
  )
  // the same kit in the hand each slide needs (the mirror image, when the data has it)
  const kits = candidates.length
    ? slides.map((at) => {
        const k = candidates[0]
        if (!k.hand) return k
        const hand = kitHand(g, base, carried, at)
        return candidates.find((x) => x.hand === hand && x.model.replace(/-M[LR]/, '') === k.model.replace(/-M[LR]/, '')) ?? k
      })
    : []
  const kit = kits[0] ?? null
  if (!kit)
    return {
      base,
      carried,
      kind,
      kit,
      kits,
      quantity,
      status: 'warn',
      note: '{pair}: {base} → {carried} 조합의 Festo 조합 키트가 데이터에 없습니다. 장착 부품을 별도로 준비하세요.',
      noteArgs: { pair, base: `${baseAxis.family}-${baseAxis.variant ? `${baseAxis.variant}-` : ''}${baseAxis.size}`, carried: `${carriedAxis.family}-${carriedAxis.variant ? `${carriedAxis.variant}-` : ''}${carriedAxis.size}` },
    }
  if (fits(kit.base, baseAxis)?.longSlide && !baseAxis.longSlide)
    return { base, carried, kind, kit, kits, quantity, status: 'warn', note: '{kit}: {axis}축은 롱 슬라이드(-L) 축이어야 합니다.', noteArgs: { kit: kit.model, axis: base.toUpperCase() } }
  if (!inRange(kit))
    return {
      base,
      carried,
      kind,
      kit,
      kits,
      quantity,
      status: 'warn',
      note: '{kit}: {axis}축 스트로크 {stroke} mm가 키트 범위 {min} … {max} mm를 벗어납니다.',
      noteArgs: { kit: kit.model, axis: carried.toUpperCase(), stroke: carriedStroke, min: kit.carriedStroke![0], max: kit.carriedStroke![1] },
    }
  return { base, carried, kind, kit, kits, quantity, status: 'ok', note: '{kit}', noteArgs: { kit: kitList(kits) } }
}

/**
 * Custom cross beams (data/adapters/Custom, `joint: 'beam'`) carrying a Z axis across two base axes of the given type
 * (the beam bolted between two Festo angle kits in place of the carried ELGT profile, the Z axis on a Festo EHAM-MA
 * plate on its pad).
 */
export function beamBrackets(baseAxis: Axis, zAxis: Axis | null, adapters: AxisAdapter[]): AxisAdapter[] {
  return adapters.filter(
    (k) => k.custom && k.joint === 'beam' && k.beam?.carries === 'z' && !!fits(k.base, baseAxis) && (!zAxis || !!fits(k.carried, zAxis)),
  )
}

/** The custom beam for a base axis type (whichever axis it is, X or Y) carrying `carriedAxis` as `carries` */
export function beamBracketFor(adapters: AxisAdapter[], baseAxis: Axis, carriedAxis: Axis, carries: 'y' | 'z'): AxisAdapter | null {
  return (
    adapters.find((k) => k.custom && k.joint === 'beam' && k.beam?.carries === carries && !!fits(k.base, baseAxis) && !!fits(k.carried, carriedAxis)) ??
    null
  )
}

/**
 * The rule for the Y beam: two base axes carrying the next axis on pinned Festo angle kits keep them when the
 * carried axis reaches all the second kit's profile mountings at the entered spacing; otherwise (the carried axis
 * too short for it) a custom beam takes its place at the entered spacing, unless the kits' walls collide there
 * (then no beam fits either).
 */
export function wantsBeam(span: NonNullable<GantryJoint['span']>, spacing: number): boolean {
  if (spacing < span.clear) return false
  return span.spacing == null || span.spacing < spacing - 0.05
}

/** mm: how far the Y beam's fixing holes stay clear of the kit walls' ends (access hole radius and a margin) */
const WALL_CLEAR = 10
/** mm: half the EHAM-MA plate's width along the beam (Z beams: the plate clear of the kit walls) */
const PLATE_HALF = 80

/**
 * A joint on a custom cross beam between the two base slides' angle kits (each reaching inwards), at the entered
 * base spacing D: beam length L = D − 2 · end. Y: pinned on the front face, its centre at the entered mounting point
 * along the beam, drive end towards the second slide; Z: on the EHAM-MA plate on the pad at the entered point,
 * hanging from it by its top drive end as on a Y slide. Warns when L is outside the beam's range, the Y fixing holes
 * reach behind a kit wall, or the plate comes too close to a kit.
 */
function beamJoint(
  g: GantryInputs,
  base: GantryAxis,
  carried: GantryAxis,
  carriedAxis: Axis,
  carriedStroke: number,
  adapters: AxisAdapter[],
  slides: number[],
  length: number | null,
  bracket: AxisAdapter,
): GantryJoint {
  const beam = bracket.beam!
  const b = axisFrame(g, base)
  const c = axisFrame(g, carried)
  const o = carried === 'z' ? g.offsets.yz : g.offsets.xy
  const v = [o.x, o.y, o.z]
  const vec = (w: number[]): Vec => ({ x: w[0] + 0, y: w[1] + 0, z: w[2] + 0 })
  const spacing = Math.abs(slides[1] - slides[0])
  const L = spacing - 2 * beam.end
  // the beam runs along the base lateral, from the first slide to the second; its front faces where the carried slide does
  const along = b.l
  const pair = beam.kits.map((m) => adapters.find((k) => k.model === m)).filter((k): k is AxisAdapter => !!k)
  const kits = slides.map((_, i) => {
    const hand = handFor(b.n, c.n, along, i === 0 ? 1 : -1)
    return pair.find((k) => k.hand === hand) ?? pair[0]
  })
  const at = dot(v, along)
  const fit = bracket.carried.find((x) => fits([x], carriedAxis))
  // the carried axis: its mounting point across as entered, along its travel where the beam holds it
  const across = v.map((x, i) => x - dot(v, c.t) * c.t[i])
  let plate: AxisAdapter | null = null
  let centre: number | null = null
  let flange: number | null = null
  const issues: { note: string; args: Record<string, string | number> }[] = []
  const name = { axis: carried.toUpperCase(), base: base.toUpperCase(), beam: bracket.model }
  const wallReach = Math.max(...kits.map((k) => k.wall?.[1] ?? 0))
  if (beam.carries === 'y') {
    // the Y centre at the entered point along the beam (its travel), drive towards the second slide
    centre = at
    if (length != null) {
      flange = at + length / 2
      // the Y fixing holes (drive end: 3 screws per row and the pins; far end: the last 3) clear of the kit walls
      const first = fit?.threads?.first ?? 0
      const pitch = fit?.threads?.pitch ?? 100
      const stroke = length - (carriedAxis.baseLength ?? 0)
      const last = first + Math.floor((stroke + pitch) / pitch) * pitch
      const lo = flange - last
      const hi = flange - first
      const free = spacing / 2 - wallReach - WALL_CLEAR
      if (lo < -free || hi > free)
        issues.push({
          note: '{beam}: {axis}축 고정 구멍({from} … {to} mm)이 키트 벽 뒤에 걸립니다. 빔 위 {axis}축 위치(장착 위치)를 옮기거나 {base}축 간격을 늘리세요(벽 사이 −{free} … {free} mm).',
          args: { ...name, from: Math.round(lo), to: Math.round(hi), free: Math.round(free) },
        })
    }
  } else {
    // the plate on the pad: the one for the Z stroke (type C / B), then the Z axis hanging by its drive end
    const plates = bracket.accessories.flatMap((x) => adapters.filter((k) => k.joint === 'plate' && k.model === x.model))
    const inRange = (k: AxisAdapter) => !k.carriedStroke || (carriedStroke >= k.carriedStroke[0] && carriedStroke <= k.carriedStroke[1])
    plate = plates.find(inRange) ?? plates[0] ?? null
    if (plate && !inRange(plate))
      issues.push({
        note: '{kit}: {axis}축 스트로크 {stroke} mm가 키트 범위 {min} … {max} mm를 벗어납니다.',
        args: { kit: plate.model, axis: name.axis, stroke: carriedStroke, min: plate.carriedStroke![0], max: plate.carriedStroke![1] },
      })
    const pfit = plate ? fits(plate.carried, carriedAxis) : undefined
    if (length != null && pfit?.end != null && beam.padHeight != null) {
      // the plate's carried end from its base (the pad centre), the body below it (as on a Y slide)
      flange = beam.padHeight - pfit.end
      centre = flange - length / 2
    }
    const free = spacing / 2 - wallReach - PLATE_HALF
    if (Math.abs(at) > free)
      issues.push({
        note: '{beam}: 패드({axis}축 장착 위치)가 키트에 너무 가깝습니다. 빔 가운데에서 {max} mm 이내로 옮기세요.',
        args: { ...name, max: Math.max(0, Math.round(free)) },
      })
  }
  // the spacing the beam's length range allows: D = L + 2 · end
  if (L < beam.length[0])
    issues.unshift({
      note: '{base}축 간격 {spacing} mm가 짧습니다: {beam} 빔 길이 L {length} mm가 최소 {min} mm보다 짧아 키트 벽이 부딪힙니다. {base}축 간격을 {need} mm 이상으로 늘리세요.',
      args: { ...name, spacing: Math.round(spacing), length: Math.round(L), min: beam.length[0], need: Math.ceil(beam.length[0] + 2 * beam.end) },
    })
  else if (L > beam.length[1])
    issues.unshift({
      note: '{base}축 간격 {spacing} mm가 깁니다: {beam} 빔 길이 L {length} mm가 최대 {max} mm보다 길어 처짐(0.05 mm)이나 고유진동수(50 Hz) 기준을 넘습니다. {base}축 간격을 {need} mm 이하로 줄이세요.',
      args: { ...name, spacing: Math.round(spacing), length: Math.round(L), max: beam.length[1], need: Math.floor(beam.length[1] + 2 * beam.end) },
    })
  const offset = vec(across.map((x, i) => x + (centre ?? dot(v, c.t)) * c.t[i]))
  // kits and beam about the beam's centre (the arrangement centre), across as entered
  const kitAt = vec(across.map((x, i) => x - (carried === 'z' ? at * along[i] : 0)))
  const joint = { kits, beam: { bracket, length: L, plate, at } }
  const issue = issues[0]
  return {
    base,
    carried,
    kind: 'beam',
    kit: kits[0],
    ...joint,
    quantity: 2,
    offset,
    kitAt,
    aligned: centre != null,
    pinned: true,
    flange,
    driveSign: 1,
    interference: false,
    status: issue ? 'warn' : 'ok',
    note: issue?.note ?? '{kit}',
    noteArgs: issue?.args ?? { kit: jointList(joint) },
  }
}

/** A beam's hardware to order with it: its accessories other than the kits and plates (which are listed as parts) */
export function beamHardware(j: Pick<GantryJoint, 'beam'>, adapters: AxisAdapter[]): AxisAdapter['accessories'] {
  return (j.beam?.bracket.accessories ?? []).filter((x) => (x.quantity ?? 0) > 0 && !adapters.some((k) => k.model === x.model))
}

/** What to order with a joint's kits (total for the joint, null when unknown): a beam's hardware, else the kits'
 *  accessories and the second kit's profile mountings */
export function jointAccessories(j: Pick<GantryJoint, 'kit' | 'quantity' | 'beam' | 'mountings'>, adapters: AxisAdapter[]): { model: string; partNumber: string; n: number | null }[] {
  if (j.beam) return beamHardware(j, adapters).map((x) => ({ model: x.model, partNumber: x.partNumber, n: x.quantity ?? null }))
  return [
    ...(j.kit?.accessories ?? []).map((x) => ({ model: x.model, partNumber: x.partNumber, n: x.quantity ? x.quantity * j.quantity : null })),
    ...(j.mountings ? [{ model: j.mountings.model, partNumber: j.mountings.partNumber, n: j.mountings.quantity }] : []),
  ]
}

/** kg of a joint's parts carried by the base axis: the kits (with the profile mountings), a beam at its length and
 *  its plate */
export function jointMass(j: Pick<GantryJoint, 'kits' | 'beam' | 'mountings'>): number {
  const kits = j.kits.reduce((m, k) => m + k.mass, 0) + (j.mountings?.mass ?? 0)
  if (!j.beam) return kits
  return kits + (j.beam.bracket.beam!.massPerMeter * j.beam.length) / 1000 + (j.beam.plate?.mass ?? 0)
}

/** A joint's parts as one line: the kits (`kitList`), then a beam with its length and its plate */
export function jointList(j: Pick<GantryJoint, 'kits' | 'beam'>, partNumbers = false): string {
  const parts = [kitList(j.kits, partNumbers)]
  if (j.beam) {
    parts.push(`${j.beam.bracket.model}${partNumbers ? ` (${'주문 제작'})` : ''} L ${Math.round(j.beam.length)} mm × 1`)
    if (j.beam.plate) parts.push(kitList([j.beam.plate], partNumbers))
  }
  return parts.join(' · ')
}

/** The kits of a joint as one line: `EHAM-AK-…-ML × 2`, or both hands `…-ML × 1 · …-MR × 1` */
export function kitList(kits: AxisAdapter[], partNumbers = false): string {
  const count = new Map<AxisAdapter, number>()
  for (const k of kits) {
    const same = [...count.keys()].find((x) => x.model === k.model) ?? k
    count.set(same, (count.get(same) ?? 0) + 1)
  }
  return [...count].map(([k, n]) => `${k.model}${partNumbers ? ` (${k.partNumber ?? '주문 제작'})` : ''} × ${n}`).join(' · ')
}
