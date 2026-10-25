import { args, closure, mapRefs, nextIdOf, pointBody, pointOf, refList, refs, referrers, typeOf, type StepFile, type Vec3 } from './step'
import { definitionByName, placementOf, shapeOf, solidsOf } from './structure'

/**
 * Length change of a prismatic axis body (profile, cover strip): everything beyond a cut plane moves along the
 * axis. Lengthening opens a gap at the cut; shortening removes a window behind the cut, dropping the features
 * (holes, slots) that lie entirely inside it. The cut is placed where only edges parallel to the axis cross it, so
 * the B-rep stays valid. All values are in the file's (assembly) coordinates, like the other frames; they are
 * turned into the part's own coordinates by its placement, which must keep the length along a coordinate axis.
 */
export interface StretchSpec {
  /** text in the PRODUCT name of the part to stretch */
  part: string
  /** further parts stretched the same way (an electric cylinder's piston rod) */
  also?: string[]
  /** coordinate index of the length direction */
  axis: 0 | 1 | 2
  /** +1 / −1: side of the cut that moves (the far end) */
  dir: 1 | -1
  /** where the cut may go, along `axis` */
  range: [number, number]
  /**
   * Other parts at the moving end (end caps, the slide when it sits there …), by the id of their placement in the
   * assembly (the second AXIS2_PLACEMENT_3D of their ITEM_DEFINED_TRANSFORMATION): moved along with it.
   */
  move?: number[]
  /** false: no hole pattern is kept (a custom beam: its end patterns must not grow), one plain cut */
  pattern?: false
}

/** The spec in the part's own coordinates */
function partSpec(file: StepFile, rep: number, spec: StretchSpec, part: string): Pick<StretchSpec, 'axis' | 'dir' | 'range'> {
  const placed = placementOf(file, rep)
  if (!placed) return spec
  const j = placed.axes.findIndex((a) => Math.abs(a[spec.axis]) > 0.9999)
  if (j < 0) throw new Error(`STEP: part "${part}" is placed at an angle to its length`)
  const s = Math.sign(placed.axes[j][spec.axis]) as 1 | -1
  const local = spec.range.map((v) => (v - placed.origin[spec.axis]) * s)
  return { axis: j as 0 | 1 | 2, dir: (spec.dir * s) as 1 | -1, range: [Math.min(...local), Math.max(...local)] }
}

export interface StretchResult {
  file: StepFile
  /** cut position along the axis (with a hole pattern: where whole pitches went in or out) */
  cut: number
  /** features removed when shortening */
  removedFaces: number
  /** pitch of the profile's hole pattern, kept by the length change; undefined when the profile has none */
  pitch?: number
}

const MARGIN = 0.5
const PARALLEL = 0.9999
/** features repeating closer than this along the axis are not a hole pattern */
const MIN_PITCH = 5
const TOL = 0.05

interface Edge {
  lo: number
  hi: number
  /** a straight line along the length direction: it may cross the cut */
  parallel: boolean
  /** a point of the edge (a circle's centre), for telling repeated features apart */
  at: Vec3
}

interface Bound {
  id: number
  edges: Edge[]
  /** extent along the axis */
  lo: number
  hi: number
  /** shape across the axis: the same feature further along has the same key */
  key: string
}

interface Face {
  id: number
  shell: number
  bounds: Bound[]
}

/** The part to stretch, in its own coordinates */
interface Body {
  file: StepFile
  solids: number[]
  axis: 0 | 1 | 2
  dir: 1 | -1
  range: [number, number]
  faces: Face[]
}

/**
 * Changes the length of `spec.part` (and `spec.also`) by `delta` and moves the parts at the moving end. A profile
 * with a hole pattern (mounting holes at a fixed pitch) keeps it: whole pitches go in or out inside the pattern,
 * copying the holes of the pitch before the cut, and the rest goes between the pattern and an end.
 */
export function stretchPart(source: StepFile, spec: StretchSpec, delta: number): StretchResult {
  const file: StepFile = { header: source.header, entities: new Map(source.entities) }
  if (Math.abs(delta) < 1e-6) return { file, cut: NaN, removedFaces: 0 }
  const e = file.entities
  const result = (spec.pattern === false ? null : stretchPattern(file, spec, delta)) ?? stretchOne(file, spec.part, spec, delta)
  for (const part of spec.also ?? []) stretchOne(file, part, spec, delta)

  // Parts at the moving end: shift their placement (a new point, the old one may be shared)
  let nextId = nextIdOf(e)
  for (const placement of spec.move ?? []) {
    const body = e.get(placement)
    if (!body || typeOf(body) !== 'AXIS2_PLACEMENT_3D') throw new Error(`STEP: #${placement} is not a placement`)
    const location = pointOf(e.get(refs(body)[0]) ?? '')
    if (!location) throw new Error(`STEP: placement #${placement} has no location`)
    location[spec.axis] += spec.dir * delta
    const point = nextId++
    e.set(point, pointBody(location))
    e.set(placement, replaceArg(body, 1, `#${point}`))
  }
  return { file, ...result }
}

/**
 * Edges on their 3D curves only: an OpenCascade export (cadgen, the custom brackets) wraps every edge curve in a
 * SURFACE_CURVE / SEAM_CURVE with parameter-space curves (pcurves), whose 2D points the length change would read as
 * extents and move. The edges then take the 3D curve; the wrappers stay unreferenced. CADENAS files have none.
 */
export function withoutPcurves(source: StepFile): StepFile {
  const e = new Map(source.entities)
  for (const [id, body] of e) {
    if (typeOf(body) !== 'EDGE_CURVE') continue
    const curve = refs(body)[2]
    const wrapper = e.get(curve) ?? ''
    if (typeOf(wrapper) === 'SURFACE_CURVE' || typeOf(wrapper) === 'SEAM_CURVE') e.set(id, replaceArg(body, 3, `#${refs(wrapper)[0]}`))
  }
  return { header: source.header, entities: e }
}

/** Stretches one part of `file` in place at one cut, as near the middle of the range as possible */
function stretchOne(file: StepFile, part: string, spec: StretchSpec, delta: number): Omit<StretchResult, 'file'> {
  const body = bodyOf(file, part, spec)
  const cut = findCut(body, delta, () => true)
  if (cut == null) throw new Error('STEP: no place to change the axis length')
  return { cut, removedFaces: cutAt(body, cut, delta) }
}

/**
 * Length change keeping the hole pattern: `delta` = n·pitch + rest. n pitches go in or out at a cut inside the
 * pattern where the pitch before the cut repeats after it; the rest goes between the pattern and the moving end of
 * the profile (its end distance changes, as on the real axis). n is rounded, then floored or ceiled when that has
 * no place. Returns null, the file untouched, when the profile has no pattern or no attempt fits.
 */
function stretchPattern(file: StepFile, spec: StretchSpec, delta: number): Omit<StretchResult, 'file'> | null {
  const pattern = patternOf(bodyOf(file, spec.part, spec))
  if (!pattern) return null
  const ratio = delta / pattern.pitch
  for (const n of new Set([Math.round(ratio), Math.floor(ratio), Math.ceil(ratio)])) {
    const trial: StepFile = { header: file.header, entities: new Map(file.entities) }
    const result = stretchPitches(trial, spec, delta, pattern, n)
    if (!result) continue
    file.entities.clear()
    for (const [id, body] of trial.entities) file.entities.set(id, body)
    return result
  }
  return null
}

function stretchPitches(
  file: StepFile,
  spec: StretchSpec,
  delta: number,
  pattern: Pattern,
  n: number,
): Omit<StretchResult, 'file'> | null {
  const { pitch } = pattern
  const whole = n * pitch
  const rest = delta - whole
  let range: [number, number] | null = null
  let cut = NaN
  let removedFaces = 0
  if (Math.abs(rest) > 1e-6) {
    // beyond the pattern towards the moving end, as near the pattern as possible
    const body = bodyOf(file, spec.part, spec)
    const ends = body.faces.flatMap((f) => f.bounds).filter((b) => Number.isFinite(b.lo))
    const from = body.dir > 0 ? pattern.hi + MARGIN : pattern.lo - MARGIN
    const profileEnd = body.dir > 0 ? Math.max(...ends.map((b) => b.hi)) : Math.min(...ends.map((b) => b.lo))
    const original = body.range
    body.range = [Math.min(from, profileEnd), Math.max(from, profileEnd)]
    const at = findCut(body, rest, () => true, from)
    if (at == null) return null
    removedFaces += cutAt(body, at, rest)
    cut = at
    // the moving end of the range moves along when the cut lies inside it
    const i = body.dir > 0 ? 1 : 0
    range = [...original]
    if ((original[i] - at) * body.dir > 0) range[i] += body.dir * rest
  }
  if (whole !== 0) {
    const body = bodyOf(file, spec.part, spec)
    if (range) body.range = range
    const at = findCut(
      body,
      whole,
      (c) => periodic(body, c, whole, pitch) && (whole < 0 || clear(body, pitchBefore(body, c, pitch), true)),
    )
    if (at == null) return null
    removedFaces += cutAt(body, at, whole, pitch)
    cut = at
  }
  return { cut, removedFaces, pitch }
}

/** Topology of a part: solids → shells → faces → bounds → edges, with their extents along the length */
function bodyOf(file: StepFile, part: string, spec: StretchSpec): Body {
  const e = file.entities
  const pd = definitionByName(file, part)
  const rep = pd != null ? shapeOf(file, pd) : null
  const solids = rep != null ? solidsOf(file, rep) : []
  if (solids.length === 0) throw new Error(`STEP: part "${part}" not found`)

  const local = partSpec(file, rep!, spec, part)
  const k = local.axis
  const point = (id: number) => pointOf(e.get(id) ?? '')
  const coord = (id: number) => point(id)?.[k]
  const extentCache = new Map<number, Edge>()
  const edgeOf = (id: number): Edge => {
    const cached = extentCache.get(id)
    if (cached) return cached
    let lo = Infinity
    let hi = -Infinity
    const extend = (v: number | undefined) => {
      if (v == null) return
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
    const [v1, v2, curveId] = refs(e.get(id)!)
    const ends = [v1, v2].map((v) => point(refs(e.get(v)!)[0])).filter((p) => p != null)
    for (const p of ends) extend(p[k])
    let at = mean(ends)
    const curve = e.get(curveId) ?? ''
    const t = typeOf(curve)
    let parallel = false
    if (t === 'LINE') {
      // a line's own point may lie anywhere on it: the vertices bound the edge
      const d = directionOf(e.get(refs(e.get(refs(curve)[1])!)[0])!)
      parallel = Math.abs(d[k]) / Math.hypot(...d) > PARALLEL
    } else if (t === 'CIRCLE' || t === 'ELLIPSE') {
      // a circle in a plane with normal n reaches r·√(1 − n_k²) along the axis from its centre; an arc only where
      // that extreme point lies on it
      const [pointId, normalId, refId] = refs(e.get(refs(curve)[0])!)
      const centre = point(pointId)
      const normal = normalId != null ? directionOf(e.get(normalId)!) : ([0, 0, 1] as Vec3)
      const r = Math.max(...args(curve).slice(2).map(Number))
      const reach = r * Math.sqrt(Math.max(0, 1 - (normal[k] / Math.hypot(...normal)) ** 2))
      if (centre) {
        const arc =
          t === 'CIRCLE' && refId != null && ends.length === 2 && Math.hypot(...sub(ends[0], ends[1])) > 1e-6
            ? arcAngles(centre, normal, directionOf(e.get(refId)!), ends, /T/.test(args(e.get(id)!)[4] ?? ''))
            : null
        for (const s of [-1, 1]) if (!arc || arc.covers(arc.extreme(k) + (s > 0 ? 0 : Math.PI))) extend(centre[k] + s * reach)
        at = centre
      }
    } else for (const c of closure(file, curveId)) extend(coord(c))
    const edge = { lo, hi, parallel, at }
    extentCache.set(id, edge)
    return edge
  }

  const faces: Face[] = []
  for (const solid of solids) {
    for (const shell of refs(e.get(solid)!)) {
      const shellBody = e.get(shell)!
      if (!/SHELL/.test(typeOf(shellBody))) continue
      for (const face of refList(args(shellBody)[1])) {
        const bounds = refList(args(e.get(face)!)[1]).map((b): Bound => {
          const loop = e.get(refs(e.get(b)!)[0])!
          const edgeIds =
            typeOf(loop) === 'EDGE_LOOP' ? refList(args(loop)[1]).map((oe) => refs(e.get(oe)!).at(-1)!) : []
          const vertexOnly = typeOf(loop) === 'VERTEX_LOOP' ? vertexEdge(file, refs(loop)[0], k) : null
          const edges = vertexOnly ? [vertexOnly] : edgeIds.map(edgeOf)
          const lo = Math.min(...edges.map((x) => x.lo))
          const hi = Math.max(...edges.map((x) => x.hi))
          const across = mean(edges.map((x) => x.at)).filter((_, i) => i !== k)
          const key = [...across, hi - lo, edges.length].map((v) => Math.round(v * 10) / 10 + 0).join('/')
          return { id: b, edges, lo, hi, key }
        })
        faces.push({ id: face, shell, bounds })
      }
    }
  }
  return { file, solids, ...local, faces }
}

interface Pattern {
  pitch: number
  /** extent of the repeating features along the length */
  lo: number
  hi: number
}

const centreOf = (b: Bound) => (b.lo + b.hi) / 2
/** a bound of a hole or another feature: no line along the length */
const isFeature = (b: Bound) => b.edges.every((x) => !x.parallel)

/**
 * The profile's hole pattern: features of the same shape repeating at the same pitch, three or more in a row. The
 * pitch with the most such features wins; lo/hi is the extent they cover.
 */
function patternOf(body: Body): Pattern | null {
  const groups = new Map<string, Bound[]>()
  for (const f of body.faces)
    for (const b of f.bounds) {
      if (!isFeature(b) || !Number.isFinite(b.lo)) continue
      const list = groups.get(b.key)
      if (list) list.push(b)
      else groups.set(b.key, [b])
    }
  const byPitch = new Map<number, Bound[]>()
  for (const list of groups.values()) {
    const at = [...new Set(list.map((b) => Math.round(centreOf(b) / TOL) * TOL))].sort((a, b) => a - b)
    // runs of equal spacing: at[start] … at[i − 1]
    let start = 0
    for (let i = 1; i <= at.length; i++) {
      const pitch = at[start + 1] - at[start]
      if (i < at.length && (i - start < 2 || Math.abs(at[i] - at[i - 1] - pitch) < TOL)) continue
      if (i - start >= 3 && pitch >= MIN_PITCH) {
        const key = Math.round(pitch / TOL) * TOL
        const inRun = list.filter((b) => centreOf(b) > at[start] - TOL && centreOf(b) < at[i - 1] + TOL)
        byPitch.set(key, [...(byPitch.get(key) ?? []), ...inRun])
      }
      start = i - 1
    }
  }
  const best = [...byPitch].sort((a, b) => b[1].length - a[1].length)[0]
  if (!best) return null
  return {
    pitch: best[0],
    lo: Math.min(...best[1].map((b) => b.lo)),
    hi: Math.max(...best[1].map((b) => b.hi)),
  }
}

const inside = (x: Edge, [w0, w1]: [number, number]) => x.lo > w0 + MARGIN && x.hi < w1 - MARGIN
const touches = (x: Edge, [w0, w1]: [number, number]) => !x.parallel && x.hi >= w0 - MARGIN && x.lo <= w1 + MARGIN

/** No feature crosses the window's borders: each bound lies inside it (when allowed) or clear of it */
function clear(body: Body, w: [number, number], allowInside: boolean): boolean {
  for (const f of body.faces)
    for (const b of f.bounds) {
      if (allowInside && b.edges.every((x) => inside(x, w))) continue
      if (b.edges.some((x) => touches(x, w))) return false
    }
  return true
}

/** window [w0, w1] behind the cut (on the moving side); empty when lengthening */
function windowOf(body: Body, c: number, delta: number): [number, number] {
  const far = delta < 0 ? c + body.dir * Math.abs(delta) : c
  return [Math.min(c, far), Math.max(c, far)]
}

/** one pitch before the cut, on the fixed side: the holes copied into the gap */
function pitchBefore(body: Body, c: number, pitch: number): [number, number] {
  const far = c - body.dir * pitch
  return [Math.min(c, far), Math.max(c, far)]
}

/**
 * The pitch before the cut repeats where it will continue after the change: right after the cut when lengthening
 * (the copies fill the gap), behind the removed window when shortening. It must hold features.
 */
function periodic(body: Body, c: number, delta: number, pitch: number): boolean {
  const [w0, w1] = pitchBefore(body, c, pitch)
  const shift = body.dir * (pitch + Math.max(0, -delta))
  const all = body.faces.flatMap((f) => f.bounds).filter(isFeature)
  const repeats = (x: Bound) => all.some((y) => y.key === x.key && Math.abs(Math.abs(centreOf(y) - centreOf(x)) - pitch) < TOL)
  // shortening keeps one-off features (as the ELGT-160's centring slot near the moving end) in place: they are left
  // out of the comparison, and the removed window must hold pattern only
  const counted = (x: Bound) => delta > 0 || repeats(x)
  const within = (a: number, b: number) => all.filter((x) => centreOf(x) > a && centreOf(x) < b)
  const before = within(w0, w1).filter(counted)
  const after = within(w0 + shift, w1 + shift).filter(counted)
  return (
    before.length > 0 &&
    before.length === after.length &&
    before.every((x) => after.some((y) => y.key === x.key && Math.abs(centreOf(y) - centreOf(x) - shift) < TOL)) &&
    (delta > 0 || within(...windowOf(body, c, delta)).every(repeats))
  )
}

/**
 * The valid cut nearest `near` (default: the middle of the range) that `accept` takes; only lines along the length
 * may cross it
 */
function findCut(body: Body, delta: number, accept: (c: number) => boolean, near?: number): number | undefined {
  const [r0, r1] = [Math.min(...body.range), Math.max(...body.range)]
  const mid = near ?? (r0 + r1) / 2
  const valid = (c: number) => {
    const w = windowOf(body, c, delta)
    return w[0] >= r0 && w[1] <= r1 && clear(body, w, delta < 0)
  }
  const candidates: number[] = []
  for (let c = r0; c <= r1; c += 0.5) candidates.push(c)
  candidates.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))
  return candidates.find((c) => valid(c) && accept(c))
}

/**
 * Changes the length at `cut`: shortening drops the bounds and faces inside the window, lengthening with a `pitch`
 * fills the gap with copies of the pitch before the cut; then the points beyond the cut move. Returns the number of
 * faces removed.
 */
function cutAt(body: Body, cut: number, delta: number, pitch?: number): number {
  const { file, faces, solids } = body
  const e = file.entities
  const k = body.axis
  const span = Math.abs(delta)

  // Shortening: drop the bounds and faces inside the window
  let removedFaces = 0
  if (delta < 0) {
    const w = windowOf(body, cut, delta)
    const removedByShell = new Map<number, Set<number>>()
    for (const f of faces) {
      const gone = f.bounds.filter((b) => b.edges.every((x) => inside(x, w)))
      if (gone.length === 0) continue
      if (gone.length === f.bounds.length) {
        removedFaces++
        const set = removedByShell.get(f.shell) ?? new Set<number>()
        set.add(f.id)
        removedByShell.set(f.shell, set)
      } else {
        const keep = f.bounds.filter((b) => !gone.includes(b)).map((b) => `#${b.id}`)
        e.set(f.id, replaceArg(e.get(f.id)!, 1, `(${keep.join(',')})`))
      }
    }
    for (const [shell, removed] of removedByShell) {
      const body = e.get(shell)!
      const keep = refList(args(body)[1]).filter((id) => !removed.has(id))
      e.set(shell, replaceArg(body, 1, `(${keep.map((id) => `#${id}`).join(',')})`))
    }
  }

  // the points to move: those of the solids, taken before any copies are added
  const inSolids = new Set<number>()
  for (const s of solids) for (const id of closure(file, s)) inSolids.add(id)

  // Lengthening by whole pitches: copies of the pitch before the cut, one per pitch, fill the gap
  if (delta > 0 && pitch) {
    const n = Math.round(delta / pitch)
    copyWindow(body, pitchBefore(body, cut, pitch), Array.from({ length: n }, (_, j) => body.dir * (j + 1) * pitch))
  }

  // Move the points beyond the cut; points used outside the stretched solids are copied first
  const by = referrers(file)
  let nextId = nextIdOf(e)
  for (const id of inSolids) {
    const p = pointOf(e.get(id) ?? '')
    if (!p) continue
    const u = (p[k] - cut) * body.dir
    if (u <= 0) continue
    const moved: Vec3 = [...p]
    moved[k] = delta > 0 ? p[k] + body.dir * delta : u >= span ? p[k] - body.dir * span : cut
    const outside = (by.get(id) ?? []).filter((r) => !inSolids.has(r))
    if (outside.length > 0) {
      // keep the original for the other users, give the solid its own copy
      const copy = nextId++
      e.set(copy, pointBody(moved))
      for (const r of by.get(id) ?? [])
        if (inSolids.has(r)) e.set(r, e.get(r)!.replace(new RegExp(`#${id}(?!\\d)`, 'g'), `#${copy}`))
    } else e.set(id, pointBody(moved))
  }
  return removedFaces
}

/**
 * Copies the features inside window `w` (whole faces, and holes in faces running past it) once per shift along
 * the length. Each copy gets its own entities, so edges shared between its faces stay shared.
 */
function copyWindow(body: Body, w: [number, number], shifts: number[]) {
  const e = body.file.entities
  const wholeFaces = new Map<number, number[]>()
  const holes = new Map<number, number[]>()
  for (const f of body.faces) {
    const inner = f.bounds.filter((b) => b.edges.every((x) => inside(x, w))).map((b) => b.id)
    if (inner.length === 0) continue
    if (inner.length === f.bounds.length) wholeFaces.set(f.shell, [...(wholeFaces.get(f.shell) ?? []), f.id])
    else holes.set(f.id, inner)
  }
  const ids = new Set<number>()
  for (const root of [...[...wholeFaces.values()].flat(), ...[...holes.values()].flat()])
    for (const id of closure(body.file, root)) ids.add(id)

  let nextId = nextIdOf(e)
  const append = (owner: number, added: number[]) => {
    const text = e.get(owner)!
    const list = [...refList(args(text)[1]), ...added]
    e.set(owner, replaceArg(text, 1, `(${list.map((id) => `#${id}`).join(',')})`))
  }
  for (const shift of shifts) {
    const map = new Map<number, number>()
    for (const id of ids) map.set(id, nextId++)
    for (const id of ids) {
      const text = e.get(id)!
      const p = pointOf(text)
      if (p) {
        p[body.axis] += shift
        e.set(map.get(id)!, pointBody(p))
      } else e.set(map.get(id)!, mapRefs(text, (r) => map.get(r) ?? r))
    }
    for (const [shell, list] of wholeFaces) append(shell, list.map((id) => map.get(id)!))
    for (const [face, list] of holes) append(face, list.map((id) => map.get(id)!))
  }
}

/** A frame on the axis after the length change: frames at the moving end (beyond the cut range) move along. */
export function stretchedOrigin(origin: Vec3, spec: StretchSpec, delta: number): Vec3 {
  const edge = spec.dir > 0 ? Math.max(...spec.range) : Math.min(...spec.range)
  if ((origin[spec.axis] - edge) * spec.dir <= 0) return origin
  const moved: Vec3 = [...origin]
  moved[spec.axis] += spec.dir * delta
  return moved
}

const directionOf = (body: string) => pointOf(body.replace(/^DIRECTION/, 'CARTESIAN_POINT'))!

/** Extent of a vertex loop's single vertex */
function vertexEdge(file: StepFile, vertex: number, k: number): Edge {
  const p = pointOf(file.entities.get(refs(file.entities.get(vertex)!)[0]) ?? '') ?? ([0, 0, 0] as Vec3)
  return { lo: p[k], hi: p[k], parallel: false, at: p }
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a)
  return [a[0] / l, a[1] / l, a[2] / l]
}

/**
 * Angles on a circle (from its reference direction, counterclockwise about its normal) and the arc an edge covers:
 * from the first vertex to the second along the circle when `sameSense`, the other way round otherwise.
 */
function arcAngles(centre: Vec3, normal: Vec3, ref: Vec3, [v1, v2]: Vec3[], sameSense: boolean) {
  const n = unit(normal)
  const x = unit(sub(ref, n.map((c) => c * dot(ref, n)) as Vec3))
  const y: Vec3 = [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]]
  const angle = (d: Vec3) => Math.atan2(dot(d, y), dot(d, x))
  const turn = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  const [a1, a2] = [angle(sub(v1, centre)), angle(sub(v2, centre))]
  const [start, end] = sameSense ? [a1, a2] : [a2, a1]
  const sweep = turn(end - start)
  return {
    /** angle of the point furthest along coordinate k */
    extreme: (k: number) => {
      const axis: Vec3 = [0, 0, 0]
      axis[k] = 1
      return angle(sub(axis, n.map((c) => c * n[k]) as Vec3))
    },
    covers: (a: number) => turn(a - start) <= sweep + 1e-9,
  }
}

const mean = (points: Vec3[]): Vec3 =>
  points.length === 0
    ? [0, 0, 0]
    : ([0, 1, 2].map((i) => points.reduce((sum, p) => sum + p[i], 0) / points.length) as Vec3)

/** Replaces the i-th top-level argument of an entity */
function replaceArg(body: string, i: number, value: string): string {
  const parts = args(body)
  parts[i] = value
  return `${body.slice(0, body.indexOf('('))}(${parts.join(',')})`
}
