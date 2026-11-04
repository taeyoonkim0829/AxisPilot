import { dot, sub } from './geometry'
import type { Vec3 } from './step'

// 2D drawing from the tessellated assembly: front, top and right side view (third-angle projection) with the
// model edges (B-rep face borders) and silhouettes, hidden parts removed with a depth buffer (an assembly outline
// drawing: hidden lines are left out, as KS B 0001 allows), laid out on a KS sheet.

export interface DrawMesh {
  /** world mm, xyz per vertex */
  positions: ArrayLike<number>
  index: ArrayLike<number>
  /** B-rep faces as triangle ranges (inclusive) */
  faces: { first: number; last: number }[]
}

export interface ViewDef {
  name: string
  right: Vec3
  up: Vec3
  /** towards the viewer */
  toViewer: Vec3
}

export const VIEWS: Record<'front' | 'top' | 'side' | 'bottom', ViewDef> = {
  front: { name: 'FRONT', right: [1, 0, 0], up: [0, 0, 1], toViewer: [0, -1, 0] },
  top: { name: 'TOP', right: [1, 0, 0], up: [0, 1, 0], toViewer: [0, 0, 1] },
  side: { name: 'RIGHT', right: [0, 1, 0], up: [0, 0, 1], toViewer: [1, 0, 0] },
  // seen from below (the axis's mounting holes on a floor mounting), its front edge towards the front view above it
  bottom: { name: 'BOTTOM', right: [1, 0, 0], up: [0, -1, 0], toViewer: [0, 0, -1] },
}

type Seg = [number, number, number, number]

interface Model {
  points: Float64Array
  /** edge vertex pairs and the triangles on each side */
  edges: { a: number; b: number; t1: number; t2: number; feature: boolean }[]
  triangles: Uint32Array
  normals: Float64Array
}

/** Angle between B-rep faces above which their common border is drawn; smaller ones are tangent edges. */
const FEATURE_ANGLE = (10 * Math.PI) / 180

export function buildModel(meshes: DrawMesh[]): Model {
  const ids = new Map<string, number>()
  const points: number[] = []
  const tris: number[] = []
  const faceOf: number[] = []
  let faceId = 0
  for (const m of meshes) {
    const local = new Map<number, number>()
    const vertex = (i: number) => {
      const cached = local.get(i)
      if (cached != null) return cached
      const p = [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]]
      const key = p.map((v) => Math.round(v * 1000)).join(',')
      let id = ids.get(key)
      if (id == null) {
        id = points.length / 3
        ids.set(key, id)
        points.push(...p)
      }
      local.set(i, id)
      return id
    }
    for (const f of m.faces) {
      for (let t = f.first; t <= f.last; t++) {
        tris.push(vertex(m.index[t * 3]), vertex(m.index[t * 3 + 1]), vertex(m.index[t * 3 + 2]))
        faceOf.push(faceId)
      }
      faceId++
    }
  }
  const p = new Float64Array(points)
  const triangles = new Uint32Array(tris)
  const count = triangles.length / 3
  const normals = new Float64Array(count * 3)
  for (let t = 0; t < count; t++) {
    const v = (j: number): Vec3 => {
      const i = triangles[t * 3 + j] * 3
      return [p[i], p[i + 1], p[i + 2]]
    }
    const a = sub(v(1), v(0))
    const b = sub(v(2), v(0))
    const n: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    const len = Math.hypot(...n) || 1
    normals.set([n[0] / len, n[1] / len, n[2] / len], t * 3)
  }
  const byKey = new Map<string, { a: number; b: number; tris: number[] }>()
  for (let t = 0; t < count; t++)
    for (let j = 0; j < 3; j++) {
      const a = triangles[t * 3 + j]
      const b = triangles[t * 3 + ((j + 1) % 3)]
      if (a === b) continue
      const key = a < b ? `${a},${b}` : `${b},${a}`
      const e = byKey.get(key)
      if (e) e.tris.push(t)
      else byKey.set(key, { a: Math.min(a, b), b: Math.max(a, b), tris: [t] })
    }
  const edges: Model['edges'] = []
  const cosFeature = Math.cos(FEATURE_ANGLE)
  for (const e of byKey.values()) {
    const [t1, t2 = -1] = e.tris
    let feature = e.tris.length !== 2
    if (!feature && faceOf[t1] !== faceOf[t2]) {
      const c = normals[t1 * 3] * normals[t2 * 3] + normals[t1 * 3 + 1] * normals[t2 * 3 + 1] + normals[t1 * 3 + 2] * normals[t2 * 3 + 2]
      feature = c < cosFeature
    }
    edges.push({ a: e.a, b: e.b, t1, t2, feature })
  }
  return { points: p, edges, triangles, normals }
}

/** Visible lines of one view, in view coordinates (right, up), mm. */
export function projectView(model: Model, view: ViewDef): Seg[] {
  const { points, triangles, normals } = model
  const n = points.length / 3
  const xs = new Float64Array(n)
  const ys = new Float64Array(n)
  const ds = new Float64Array(n)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < n; i++) {
    const p: Vec3 = [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]]
    xs[i] = dot(p, view.right)
    ys[i] = dot(p, view.up)
    ds[i] = dot(p, view.toViewer)
    minX = Math.min(minX, xs[i])
    maxX = Math.max(maxX, xs[i])
    minY = Math.min(minY, ys[i])
    maxY = Math.max(maxY, ys[i])
  }
  const size = Math.max(maxX - minX, maxY - minY)
  const px = Math.max(size / 2400, 0.05)
  const w = Math.ceil((maxX - minX) / px) + 3
  const h = Math.ceil((maxY - minY) / px) + 3
  const depth = new Float32Array(w * h).fill(-Infinity)
  const gx = (x: number) => (x - minX) / px + 1
  const gy = (y: number) => (y - minY) / px + 1

  // depth buffer: largest depth (nearest the viewer) per pixel centre
  for (let t = 0; t < triangles.length / 3; t++) {
    const [i0, i1, i2] = [triangles[t * 3], triangles[t * 3 + 1], triangles[t * 3 + 2]]
    const x0 = gx(xs[i0]), y0 = gy(ys[i0]), x1 = gx(xs[i1]), y1 = gy(ys[i1]), x2 = gx(xs[i2]), y2 = gy(ys[i2])
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
    if (Math.abs(area) < 1e-12) continue
    const xa = Math.max(0, Math.floor(Math.min(x0, x1, x2)))
    const xb = Math.min(w - 1, Math.ceil(Math.max(x0, x1, x2)))
    const ya = Math.max(0, Math.floor(Math.min(y0, y1, y2)))
    const yb = Math.min(h - 1, Math.ceil(Math.max(y0, y1, y2)))
    for (let y = ya; y <= yb; y++)
      for (let x = xa; x <= xb; x++) {
        const cx = x + 0.5
        const cy = y + 0.5
        const l1 = ((x1 - cx) * (y2 - cy) - (x2 - cx) * (y1 - cy)) / area
        const l2 = ((x2 - cx) * (y0 - cy) - (x0 - cx) * (y2 - cy)) / area
        const l3 = 1 - l1 - l2
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue
        const d = l1 * ds[i0] + l2 * ds[i1] + l3 * ds[i2]
        const k = y * w + x
        if (d > depth[k]) depth[k] = d
      }
  }
  const nearest = (x: number, y: number) => {
    // lowest of the 3×3 neighbourhood: an edge on a visible surface is never below all its neighbours
    const cx = Math.floor(gx(x))
    const cy = Math.floor(gy(y))
    let lo = Infinity
    for (let yy = cy - 1; yy <= cy + 1; yy++)
      for (let xx = cx - 1; xx <= cx + 1; xx++)
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) lo = Math.min(lo, depth[yy * w + xx])
    return lo
  }
  const eps = px * 2 + size * 1e-5
  // −1 back, 0 edge-on, +1 facing the viewer; an outline runs where this changes (rounded profile corners
  // meet the side faces tangentially, and a side face seen exactly edge-on is neither front nor back)
  const facing = (t: number) => {
    const c = normals[t * 3] * view.toViewer[0] + normals[t * 3 + 1] * view.toViewer[1] + normals[t * 3 + 2] * view.toViewer[2]
    return c > 1e-6 ? 1 : c < -1e-6 ? -1 : 0
  }

  const segs: Seg[] = []
  for (const e of model.edges) {
    const silhouette = e.t2 >= 0 && facing(e.t1) !== facing(e.t2)
    if (!e.feature && !silhouette) continue
    const ax = xs[e.a], ay = ys[e.a], bx = xs[e.b], by = ys[e.b]
    const len = Math.hypot(bx - ax, by - ay)
    if (len < 1e-6) continue
    const steps = Math.max(2, Math.ceil(len / (px * 0.7)))
    let runStart = -1
    for (let s = 0; s <= steps; s++) {
      const u = s / steps
      const x = ax + (bx - ax) * u
      const y = ay + (by - ay) * u
      const d = ds[e.a] + (ds[e.b] - ds[e.a]) * u
      const visible = d >= nearest(x, y) - eps
      if (visible && runStart < 0) runStart = s
      if ((!visible || s === steps) && runStart >= 0) {
        const end = visible ? s : s - 1
        if (end > runStart) {
          const u0 = runStart / steps
          const u1 = end / steps
          segs.push([ax + (bx - ax) * u0, ay + (by - ay) * u0, ax + (bx - ax) * u1, ay + (by - ay) * u1])
        }
        runStart = -1
      }
    }
  }
  return mergeCollinear(segs)
}

/** A mounting hole on the bottom: centre (world x, y) and diameter, mm */
export interface Hole {
  x: number
  y: number
  d: number
}

/**
 * The holes opening on the underside of the axis: B-rep faces that are vertical cylinders (all normals horizontal,
 * the vertices on one circle; split walls merged) reaching down to within 1.5 mm of the axis's lowest point. Returns the holes and the axis's length
 * along x, or null when there are none.
 */
export function mountingHoles(meshes: DrawMesh[]): { holes: Hole[]; x0: number; x1: number } | null {
  let zMin = Infinity
  let x0 = Infinity
  let x1 = -Infinity
  for (const m of meshes)
    for (let i = 0; i < m.positions.length; i += 3) {
      zMin = Math.min(zMin, m.positions[i + 2])
      x0 = Math.min(x0, m.positions[i])
      x1 = Math.max(x1, m.positions[i])
    }
  // vertical cylinder faces (a file may split a hole's wall into arcs): circle through three spread vertices,
  // every vertex on it; arcs of one hole merged by centre and radius
  const arcs: { x: number; y: number; r: number; z0: number }[] = []
  for (const m of meshes) {
    const p = m.positions
    for (const f of m.faces) {
      const ids = new Set<number>()
      let vertical = true
      for (let t = f.first; t <= f.last && vertical; t++) {
        const [a, b, c] = [m.index[t * 3], m.index[t * 3 + 1], m.index[t * 3 + 2]]
        const u = [p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]]
        const v = [p[c * 3] - p[a * 3], p[c * 3 + 1] - p[a * 3 + 1], p[c * 3 + 2] - p[a * 3 + 2]]
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
        const len = Math.hypot(n[0], n[1], n[2])
        if (len > 1e-9 && Math.abs(n[2] / len) > 0.02) vertical = false
        ids.add(a).add(b).add(c)
      }
      if (!vertical || ids.size < 6) continue
      const pts = [...ids].map((i) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]])
      const far = (from: number[], score: (q: number[]) => number) => pts.reduce((a, q) => (score(q) > score(a) ? q : a))
      const A = pts[0]
      const B = far(A, (q) => Math.hypot(q[0] - A[0], q[1] - A[1]))
      const C = far(A, (q) => Math.abs((B[0] - A[0]) * (q[1] - A[1]) - (B[1] - A[1]) * (q[0] - A[0])))
      const d = 2 * (A[0] * (B[1] - C[1]) + B[0] * (C[1] - A[1]) + C[0] * (A[1] - B[1]))
      if (Math.abs(d) < 1e-6) continue
      const sq = (q: number[]) => q[0] * q[0] + q[1] * q[1]
      const cx = (sq(A) * (B[1] - C[1]) + sq(B) * (C[1] - A[1]) + sq(C) * (A[1] - B[1])) / d
      const cy = (sq(A) * (C[0] - B[0]) + sq(B) * (A[0] - C[0]) + sq(C) * (B[0] - A[0])) / d
      const r = Math.hypot(A[0] - cx, A[1] - cy)
      if (r < 1 || r > 12) continue
      if (pts.some((q) => Math.abs(Math.hypot(q[0] - cx, q[1] - cy) - r) > 0.03 * r + 0.02)) continue
      arcs.push({ x: cx, y: cy, r, z0: Math.min(...pts.map((q) => q[2])) })
    }
  }
  const holes: (Hole & { z0: number })[] = []
  for (const a of arcs) {
    const h = holes.find((o) => Math.hypot(o.x - a.x, o.y - a.y) < 0.3 && Math.abs(o.d / 2 - a.r) < 0.1)
    if (h) h.z0 = Math.min(h.z0, a.z0)
    else holes.push({ x: a.x, y: a.y, d: Math.round(2 * a.r * 10) / 10, z0: a.z0 })
  }
  // open at the bottom (the profile's underside may sit a little above the heads')
  const open = holes.filter((h) => h.z0 <= zMin + 1.5).map(({ x, y, d }) => ({ x, y, d }))
  return open.length ? { holes: open, x0, x1 } : null
}


/** gaps along a row, equal neighbours (±0.05 mm) merged: [from, to, count, pitch] */
function chain(points: number[]): [number, number, number, number][] {
  const out: [number, number, number, number][] = []
  for (let i = 1; i < points.length; i++) {
    const gap = points[i] - points[i - 1]
    const last = out[out.length - 1]
    if (last && Math.abs(last[3] - gap) < 0.05) {
      last[1] = points[i]
      last[2]++
    } else out.push([points[i - 1], points[i], 1, gap])
  }
  return out
}

/** Joins chained segments that continue in the same direction (tessellated straight edges). */
function mergeCollinear(segs: Seg[]): Seg[] {
  const key = (x: number, y: number) => `${Math.round(x * 100)},${Math.round(y * 100)}`
  const at = new Map<string, number[]>()
  segs.forEach((s, i) => {
    for (const k of [key(s[0], s[1]), key(s[2], s[3])]) at.set(k, [...(at.get(k) ?? []), i])
  })
  const used = new Uint8Array(segs.length)
  const out: Seg[] = []
  const dir = (s: Seg) => {
    const l = Math.hypot(s[2] - s[0], s[3] - s[1])
    return [(s[2] - s[0]) / l, (s[3] - s[1]) / l]
  }
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue
    used[i] = 1
    let s: Seg = [...segs[i]]
    for (let grew = true; grew; ) {
      grew = false
      const [dx, dy] = dir(s)
      for (const end of [1, 0]) {
        const k = end ? key(s[2], s[3]) : key(s[0], s[1])
        for (const j of at.get(k) ?? []) {
          if (used[j]) continue
          const o = segs[j]
          const [ox, oy] = dir(o)
          if (Math.abs(dx * oy - dy * ox) > 1e-4) continue
          const oStartsHere = key(o[0], o[1]) === k
          const far: [number, number] = oStartsHere ? [o[2], o[3]] : [o[0], o[1]]
          const joint = end ? [s[2], s[3]] : [s[0], s[1]]
          const ahead = ((far[0] - joint[0]) * dx + (far[1] - joint[1]) * dy) * (end ? 1 : -1)
          if (ahead <= 1e-6) {
            // lying back over this one (two edges seen on the same line): a duplicate when it ends within it
            if (-ahead <= Math.hypot(s[2] - s[0], s[3] - s[1]) + 1e-6) used[j] = 1
            continue
          }
          used[j] = 1
          s = end ? [s[0], s[1], far[0], far[1]] : [far[0], far[1], s[2], s[3]]
          grew = true
          break
        }
      }
    }
    out.push(s)
  }
  return out
}


// ---- the drawing sheet, after KS A 0005 (제도 통칙) and KS B 0001 (기계 제도), KS A 0106 (sheet sizes) ----
// Model space is full size (mm), so a CAD user measures true lengths; the sheet, its text, line widths and line type
// patterns are drawn at the drawing scale (paper mm × the scale's denominator) and print at that scale.

export interface DrawingPart {
  /** what the part is (axis, kit, motor …) */
  role: string
  /** model / type code */
  name: string
}

/** the sheet's own words (the DXF keeps these English defaults; the PDF takes the app language's) */
export interface SheetLabels {
  title: string
  dwgNo: string
  scale: string
  projection: string
  unit: string
  date: string
  drawn: string
  no: string
  part: string
  model: string
  qty: string
  notes: string
  specs: string
  stroke: string
  cogNote: string
  /** part roles as named in the parts list (default: the role in capitals) */
  roles: Record<string, string>
}

export const DEFAULT_LABELS: SheetLabels = {
  title: 'TITLE',
  dwgNo: 'DWG. NO.',
  scale: 'SCALE',
  projection: 'PROJ.',
  unit: 'UNIT',
  date: 'DATE',
  drawn: 'DRAWN',
  no: 'NO.',
  part: 'PART',
  model: 'MODEL / TYPE',
  qty: 'QTY',
  notes: 'Note',
  specs: 'SPECIFICATIONS',
  stroke: 'STROKE',
  cogNote: 'COG: payload centre of gravity (thin two-dot chain lines).',
  roles: {},
}

export interface DrawingInput {
  meshes: DrawMesh[]
  cog: Vec3 | null
  /** the drawing title first, then notes (ASCII) */
  title: string[]
  /** the assembly's parts, for the parts list (equal names are counted together) */
  parts?: DrawingPart[]
  /** date for the title block, YYYY-MM-DD (default today) */
  date?: string
  labels?: SheetLabels
  /** the slide centre at the start and the end of the stroke (world mm), dimensioned on the front view */
  stroke?: { from: Vec3; to: Vec3; length: number }
  /** specification table rows: label, value */
  specs?: [string, string][]
  /** the axis's own meshes, for its mounting holes on the bottom view (pitch dimensions and callouts) */
  axisMeshes?: DrawMesh[]
}

/** A-series sheets, landscape (paper mm) and their border margin (KS A 0106: 20 mm on A0 / A1, 10 mm below); the
 *  filing margin on the left is 25 mm. */
const SHEETS = [
  { name: 'A3', w: 420, h: 297, c: 10 },
  { name: 'A2', w: 594, h: 420, c: 10 },
  { name: 'A1', w: 841, h: 594, c: 20 },
  { name: 'A0', w: 1189, h: 841, c: 20 },
] as const
const FILING = 25
/** scales (KS A ISO 5455 recommended, plus 1:3): denominators, 0.5 = 2:1 */
const SCALES = [0.5, 1, 2, 3, 5, 10, 20, 50, 100, 200, 500]
/** the drawing should be readable: the smallest sheet on which the views fit at 1:3 or larger */
const READABLE = 3
/** line widths (paper mm): thick outline / border, thin is a hairline (LINE) */
const THICK = 0.5
const BORDER = 0.7
/** text heights (paper mm, KS A 0107 series) */
const TEXT_DIM = 3.5
const TEXT_SMALL = 2.5
/** title block and parts list width (KS: at most 170 mm) */
const BLOCK_W = 170
const TITLE_ROWS = [12, 10, 8]
const PART_ROW = 7
const NOTE_PITCH = 4.5
const NOTE_CHARS = 66
/** room the views keep for their dimensions (paper mm) and the space between views */
const DIM_OFFSET = 10
const DIM_ROOM = 18
const VIEW_GAP = 28
const PAD = 8

const scaleText = (n: number) => (n < 1 ? `${1 / n}:1` : `1:${n}`)
/** dimension value: whole mm, or one decimal */
const dimValue = (v: number) => String(Math.round(v * 10) / 10)

/** text width in ASCII characters: a character beyond ASCII (Hangul) about as wide as two */
const textWidth = (s: string) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x7e ? 1.7 : 1), 0)

function wrap(line: string, width: number): string[] {
  const out: string[] = []
  let rest = line.trim()
  while (textWidth(rest) > width) {
    // the last whole character within the width, back to a space when there is one in its second half
    let end = 0
    for (let w = 0; end < rest.length && w + textWidth(rest[end]) <= width; end++) w += textWidth(rest[end])
    const cut = rest.lastIndexOf(' ', end)
    const at = cut > end / 2 ? cut : Math.max(1, end)
    out.push(rest.slice(0, at).trimEnd())
    rest = rest.slice(at).trimStart()
  }
  if (rest) out.push(rest)
  return out
}

/** Lays out the three views (third-angle) on a KS sheet with border, title block, parts list and notes. */
export function layoutSheet({ meshes, cog, title, parts = [], date, labels: L = DEFAULT_LABELS, stroke, specs = [], axisMeshes }: DrawingInput): Sheet {
  const model = buildModel(meshes)
  const mounting = axisMeshes ? mountingHoles(axisMeshes) : null
  // below the bottom view: the hole pitch chain, then the overall length
  const below = mounting ? DIM_ROOM + DIM_OFFSET : DIM_ROOM
  const views = [VIEWS.front, VIEWS.top, VIEWS.side, VIEWS.bottom].map((v) => {
    const segs = projectView(model, v)
    return { v, segs, box: bbox(segs) }
  })
  const [front, top, side, bottom] = views.map((v) => v.box)
  const wOf = (b: ReturnType<typeof bbox>) => b.x1 - b.x0
  const hOf = (b: ReturnType<typeof bbox>) => b.y1 - b.y0
  // views and their dimensions at scale 1/n (paper mm)
  const content = (n: number) => ({
    w: DIM_ROOM + (wOf(front) + wOf(side)) / n + VIEW_GAP,
    h: below + (hOf(bottom) + hOf(front) + hOf(top)) / n + 2 * VIEW_GAP,
  })

  // parts list rows: equal names counted together, in assembly order
  const rows: { role: string; name: string; qty: number }[] = []
  for (const p of parts) {
    const row = rows.find((r) => r.name === p.name && r.role === p.role)
    if (row) row.qty++
    else rows.push({ role: p.role, name: p.name, qty: 1 })
  }
  const [name = 'Assembly', ...given] = title
  const notes = [
    ...(cog ? [L.cogNote] : []),
    ...given,
  ].flatMap((line, i) => wrap(`${i + 1}. ${line}`, NOTE_CHARS))
  const titleH = TITLE_ROWS.reduce((a, b) => a + b, 0)
  const partsH = rows.length ? PART_ROW * (rows.length + 1) : 0
  const specsH = specs.length ? PART_ROW * (specs.length + 1) : 0
  const notesH = NOTE_PITCH * (notes.length + 1) + 3
  const blockH = titleH + partsH + specsH + notesH

  // the smallest sheet on which the views fit at 1:3 or larger, else the largest scale on A0; the views go above
  // the title block column or to its left, whichever fits
  const fit = (sheet: (typeof SHEETS)[number], n: number) => {
    const inner = { x0: FILING, y0: sheet.c, x1: sheet.w - sheet.c, y1: sheet.h - sheet.c }
    const c = content(n)
    const regions = [
      { x0: inner.x0, y0: inner.y0 + blockH, x1: inner.x1, y1: inner.y1 },
      { x0: inner.x0, y0: inner.y0, x1: inner.x1 - BLOCK_W, y1: inner.y1 },
    ]
    const region = regions.find((r) => r.x1 - r.x0 >= c.w + 2 * PAD && r.y1 - r.y0 >= c.h + 2 * PAD)
    return region && blockH <= inner.y1 - inner.y0 ? { sheet, n, region, c } : null
  }
  const best = (sheet: (typeof SHEETS)[number]) => SCALES.map((n) => fit(sheet, n)).find((f) => f != null) ?? null
  const a0 = SHEETS[SHEETS.length - 1]
  const layout = SHEETS.map(best).find((f) => f != null && f.n <= READABLE) ??
    best(a0) ?? {
      // too large for A0 at any standard scale: the smallest one, above the title block anyway
      sheet: a0,
      n: SCALES[SCALES.length - 1],
      region: { x0: FILING, y0: a0.c + blockH, x1: a0.w - a0.c, y1: a0.h - a0.c },
      c: content(SCALES[SCALES.length - 1]),
    }
  const { sheet, n, region, c } = layout
  const inner = { x0: FILING, y0: sheet.c, x1: sheet.w - sheet.c, y1: sheet.h - sheet.c }
  const P = (v: number) => v * n

  const dxf = new Sheet(n, sheet)

  // ---- border (윤곽선) and centring marks (중심 마크)
  dxf.rect('BORDER', P(inner.x0), P(inner.y0), P(inner.x1), P(inner.y1), P(BORDER))
  dxf.line('BORDER', 0, 0, P(sheet.w), 0)
  dxf.line('BORDER', P(sheet.w), 0, P(sheet.w), P(sheet.h))
  dxf.line('BORDER', P(sheet.w), P(sheet.h), 0, P(sheet.h))
  dxf.line('BORDER', 0, P(sheet.h), 0, 0)
  const mx = (inner.x0 + inner.x1) / 2
  const my = (inner.y0 + inner.y1) / 2
  dxf.thick('BORDER', P(mx), 0, P(mx), P(inner.y0 + 5), P(THICK))
  dxf.thick('BORDER', P(mx), P(sheet.h), P(mx), P(inner.y1 - 5), P(THICK))
  dxf.thick('BORDER', 0, P(my), P(inner.x0 + 5), P(my), P(THICK))
  dxf.thick('BORDER', P(sheet.w), P(my), P(inner.x1 - 5), P(my), P(THICK))

  // ---- views (third angle): bottom view at the lower left, the front view above it, the top view above that, the
  // right side view right of the front view; centred in the region
  const ox = region.x0 + PAD + (region.x1 - region.x0 - 2 * PAD - c.w) / 2 + DIM_ROOM
  const oy = region.y0 + PAD + (region.y1 - region.y0 - 2 * PAD - c.h) / 2 + below
  const fy = P(oy + VIEW_GAP) + hOf(bottom)
  const at: [number, number][] = [
    [P(ox) - front.x0, fy - front.y0],
    [P(ox) - top.x0, fy + P(VIEW_GAP) + hOf(front) - top.y0],
    [P(ox + VIEW_GAP) + wOf(front) - side.x0, fy - side.y0],
    [P(ox) - bottom.x0, P(oy) - bottom.y0],
  ]
  views.forEach(({ v, segs, box }, i) => {
    const [dx, dy] = at[i]
    for (const s of segs) dxf.thick('OUTLINE', s[0] + dx, s[1] + dy, s[2] + dx, s[3] + dy, P(THICK))
    const b = { x0: box.x0 + dx, y0: box.y0 + dy, x1: box.x1 + dx, y1: box.y1 + dy }
    // overall dimensions, each once: height on the front view, depth on the top view, length below the bottom view
    if (i === 0) {
      dxf.dimension(b.x0, b.y0, b.x0, b.y1, -P(DIM_OFFSET), 'v')
      if (stroke) {
        // the stroke: between the slide centre at its start and its end, above the front view (or right of it
        // when the travel is vertical)
        const [x1, y1, x2, y2] = [dot(stroke.from, v.right) + dx, dot(stroke.from, v.up) + dy, dot(stroke.to, v.right) + dx, dot(stroke.to, v.up) + dy]
        const label = `${L.stroke} ${dimValue(stroke.length)}`
        if (Math.abs(x2 - x1) >= Math.abs(y2 - y1)) dxf.dimension(Math.min(x1, x2), b.y1, Math.max(x1, x2), b.y1, P(DIM_OFFSET), 'h', label)
        else dxf.dimension(b.x1, Math.min(y1, y2), b.x1, Math.max(y1, y2), P(DIM_OFFSET), 'v', label)
      }
    }
    if (i === 1) dxf.dimension(b.x0, b.y0, b.x0, b.y1, -P(DIM_OFFSET), 'v')
    if (i === 3) {
      dxf.dimension(b.x0, b.y0, b.x1, b.y0, -P(mounting ? 2 * DIM_OFFSET : DIM_OFFSET), 'h')
      if (mounting) holeDimensions(dxf, mounting, b, dx, dy, n)
    }
    if (cog) {
      // centre of gravity: two-dot chain lines (무게 중심선) across the view and a small circle
      const x = dot(cog, v.right) + dx
      const y = dot(cog, v.up) + dy
      const over = P(4)
      dxf.line('COG', b.x0 - over, y, b.x1 + over, y)
      dxf.line('COG', x, b.y0 - over, x, b.y1 + over)
      dxf.circle('COG-MARK', x, y, P(1.5))
      dxf.text('COG-MARK', x + P(2.5), y + P(2), P(TEXT_SMALL), 'COG')
    }
  })

  // ---- title block (표제란) at the lower right
  const bx0 = inner.x1 - BLOCK_W
  let y = inner.y0
  const cell = (x0: number, y0: number, x1: number, y1: number) => {
    dxf.line('TITLE', P(x0), P(y0), P(x1), P(y0))
    dxf.line('TITLE', P(x1), P(y0), P(x1), P(y1))
    dxf.line('TITLE', P(x1), P(y1), P(x0), P(y1))
    dxf.line('TITLE', P(x0), P(y1), P(x0), P(y0))
  }
  /** text vertically centred in a row, left (with a 2 mm gap) or centred in its cell */
  const put = (x0: number, x1: number, y0: number, h: number, value: string, size = TEXT_SMALL, centred = false) =>
    dxf.text('TEXT', P(centred ? (x0 + x1) / 2 : x0 + 2), P(y0 + (h - size) / 2), P(size), value, centred ? 'centre' : 'left')
  const row = (h: number, cells: [number, string, number?][]) => {
    let x = bx0
    for (const [w, value, size] of cells) {
      cell(x, y, x + w, y + h)
      put(x, x + w, y, h, value, size)
      x += w
    }
    y += h
  }
  row(TITLE_ROWS[2], [
    [22, L.date],
    [36, date ?? new Date().toISOString().slice(0, 10)],
    [16, L.unit],
    [24, 'mm'],
    [18, L.drawn],
    [54, 'AxisPilot'],
  ])
  const projectionY = y
  row(TITLE_ROWS[1], [
    [22, L.dwgNo],
    [36, `AP-${(date ?? new Date().toISOString().slice(0, 10)).replace(/-/g, '')}`],
    [16, L.scale],
    [24, scaleText(n), TEXT_DIM],
    [18, L.projection],
    [54, ''],
  ])
  projectionSymbol(dxf, P(bx0 + 170 - 27), P(projectionY + TITLE_ROWS[1] / 2), n)
  // the title: the largest standard height whose text fits the cell
  // (a character about as wide as it is high, spacing included)
  const room = BLOCK_W - 22 - 4
  const titleSize = [5, TEXT_DIM, TEXT_SMALL].find((h) => textWidth(name) * h <= room) ?? TEXT_SMALL
  row(TITLE_ROWS[0], [
    [22, L.title],
    [148, name, titleSize],
  ])
  dxf.rect('TITLE', P(bx0), P(inner.y0), P(inner.x1), P(y), P(THICK))

  // ---- parts list (부품란) above it: header at the bottom, numbers counting upwards
  if (rows.length) {
    const cols: [number, string][] = [
      [12, L.no],
      [34, L.part],
      [104, L.model],
      [20, L.qty],
    ]
    const partsY0 = y
    const line = (values: string[]) => {
      let x = bx0
      cols.forEach(([w], i) => {
        cell(x, y, x + w, y + PART_ROW)
        put(x, x + w, y, PART_ROW, values[i], TEXT_SMALL, i !== 2)
        x += w
      })
      y += PART_ROW
    }
    line(cols.map(([, h]) => h))
    rows.forEach((r, i) => line([String(i + 1), L.roles[r.role] ?? r.role.toUpperCase(), r.name, String(r.qty)]))
    dxf.rect('TITLE', P(bx0), P(partsY0), P(inner.x1), P(y), P(THICK))
  }

  // ---- specification table (사양) above it
  if (specs.length) {
    const specsY0 = y
    const cols = [60, 110]
    const line = (values: [string, string], header = false) => {
      let x = bx0
      cols.forEach((w) => {
        if (!header) cell(x, y, x + w, y + PART_ROW)
        x += w
      })
      if (header) cell(bx0, y, bx0 + BLOCK_W, y + PART_ROW)
      put(bx0, bx0 + cols[0], y, PART_ROW, values[0])
      if (!header) put(bx0 + cols[0], bx0 + BLOCK_W, y, PART_ROW, values[1])
      y += PART_ROW
    }
    for (const r of [...specs].reverse()) line(r)
    line([L.specs, ''], true)
    dxf.rect('TITLE', P(bx0), P(specsY0), P(inner.x1), P(y), P(THICK))
  }

  // ---- notes (주기) above the parts list
  y += 3
  for (const note of [...notes].reverse()) {
    dxf.text('TEXT', P(bx0), P(y), P(TEXT_SMALL), note)
    y += NOTE_PITCH
  }
  dxf.text('TEXT', P(bx0), P(y), P(TEXT_DIM), L.notes)

  return dxf
}

/**
 * The mounting holes on the bottom view (KS B 0001): the pitch chain of the longest row from the axis end to end below
 * the view (equal pitches as `n×p(=total)`), the spacing of the rows on its right, and one callout `n×Ød` per
 * hole size with a leader to a hole.
 */
function holeDimensions(dxf: Sheet, m: { holes: Hole[]; x0: number; x1: number }, b: { x0: number; y0: number; x1: number; y1: number }, dx: number, dy: number, n: number) {
  const P = (v: number) => v * n
  // bottom view: x as world x, up = world −y
  const vx = (x: number) => x + dx
  const vy = (y: number) => -y + dy
  const sizes = [...new Set(m.holes.map((h) => h.d))].sort((a, c) => m.holes.filter((h) => h.d === c).length - m.holes.filter((h) => h.d === a).length)
  const main = m.holes.filter((h) => h.d === sizes[0])
  const rows: Hole[][] = []
  for (const h of [...main].sort((a, c) => a.y - c.y)) {
    const row = rows.find((r) => Math.abs(r[0].y - h.y) < 0.5)
    if (row) row.push(h)
    else rows.push([h])
  }
  const longest = rows.reduce((a, r) => (r.length > a.length ? r : a))
  const xs = [m.x0, ...longest.map((h) => h.x).sort((a, c) => a - c), m.x1]
  for (const [from, to, count, pitch] of chain(xs)) {
    const label = count > 1 ? `${count}×${dimValue(pitch)}(=${dimValue(to - from)})` : undefined
    dxf.dimension(vx(from), b.y0, vx(to), b.y0, -P(DIM_OFFSET), 'h', label)
  }
  // the rows' spacing, right of the view
  if (rows.length > 1) {
    const ys = rows.map((r) => vy(r[0].y)).sort((a, c) => a - c)
    for (let i = 1; i < ys.length; i++) dxf.dimension(b.x1, ys[i - 1], b.x1, ys[i], P(DIM_OFFSET), 'v')
  }
  // callouts: count × diameter, the leader to the hole nearest the view's right end
  sizes.slice(0, 3).forEach((d, k) => {
    const of = m.holes.filter((h) => h.d === d)
    const h = of.reduce((a, c) => (c.x > a.x ? c : a))
    const tx = b.x1 + P(DIM_OFFSET + 8)
    const ty = b.y1 - P(6 + k * 6)
    dxf.line('DIM', vx(h.x), vy(h.y), tx - P(1), ty + P(1))
    dxf.text('DIM', tx, ty, P(TEXT_SMALL), `${of.length}\u00d7\u00d8${dimValue(d)}`)
  })
}

/** Third-angle projection symbol (KS A ISO 128 / 5456): the truncated cone, narrow end towards its end view on the right. */
function projectionSymbol(dxf: Sheet, cx: number, cy: number, n: number) {
  const P = (v: number) => v * n
  const [x0, x1] = [cx - P(10), cx - P(2)]
  dxf.line('TITLE', x0, cy - P(3), x0, cy + P(3))
  dxf.line('TITLE', x1, cy - P(1.5), x1, cy + P(1.5))
  dxf.line('TITLE', x0, cy + P(3), x1, cy + P(1.5))
  dxf.line('TITLE', x0, cy - P(3), x1, cy - P(1.5))
  dxf.circle('TITLE', cx + P(6), cy, P(3))
  dxf.circle('TITLE', cx + P(6), cy, P(1.5))
}

const bbox = (segs: Seg[]) => {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  for (const s of segs) {
    b.x0 = Math.min(b.x0, s[0], s[2])
    b.x1 = Math.max(b.x1, s[0], s[2])
    b.y0 = Math.min(b.y0, s[1], s[3])
    b.y1 = Math.max(b.y1, s[1], s[3])
  }
  return b
}

/** layers: name, colour, line type (외형선 thick continuous, 치수선 thin, 무게 중심선 thin two-dot chain) */
const LAYERS: [string, number, string][] = [
  ['OUTLINE', 7, 'CONTINUOUS'],
  ['DIM', 3, 'CONTINUOUS'],
  ['COG', 1, 'PHANTOM'],
  ['COG-MARK', 1, 'CONTINUOUS'],
  ['TEXT', 7, 'CONTINUOUS'],
  ['BORDER', 7, 'CONTINUOUS'],
  ['TITLE', 7, 'CONTINUOUS'],
]
/** two-dot chain line pattern (paper mm; $LTSCALE takes the drawing scale): dash, gap, dot, gap, dot, gap */
export const PHANTOM = [12, -1.5, 0, -1.5, 0, -1.5]


export type SheetOp =
  | { k: 'line'; layer: string; x1: number; y1: number; x2: number; y2: number }
  | { k: 'poly'; layer: string; points: [number, number][]; width: number; closed: boolean }
  | { k: 'circle'; layer: string; x: number; y: number; r: number }
  | { k: 'text'; layer: string; x: number; y: number; height: number; value: string; align: 'left' | 'centre'; rotation: number }
  | { k: 'solid'; layer: string; points: [number, number][] }

/** The laid out sheet: drawing primitives in model mm, written out as DXF (`toDxf`) or PDF (`drawingPdf`). */
export class Sheet {
  ops: SheetOp[] = []
  /** the drawing scale's denominator: paper mm × n = model mm */
  n: number
  /** sheet name and size (paper mm, landscape) */
  size: string
  w: number
  h: number
  constructor(n: number, sheet: { name: string; w: number; h: number }) {
    this.n = n
    this.size = sheet.name
    this.w = sheet.w
    this.h = sheet.h
  }
  line(layer: string, x1: number, y1: number, x2: number, y2: number) {
    this.ops.push({ k: 'line', layer, x1, y1, x2, y2 })
  }
  /** a line with a width (thick lines: R12 has no line weights, a wide polyline prints at its width) */
  thick(layer: string, x1: number, y1: number, x2: number, y2: number, width: number) {
    this.ops.push({ k: 'poly', layer, points: [[x1, y1], [x2, y2]], width, closed: false })
  }
  rect(layer: string, x0: number, y0: number, x1: number, y1: number, width: number) {
    this.ops.push({ k: 'poly', layer, points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], width, closed: true })
  }
  circle(layer: string, x: number, y: number, r: number) {
    this.ops.push({ k: 'circle', layer, x, y, r })
  }
  text(layer: string, x: number, y: number, height: number, value: string, align: 'left' | 'centre' = 'left', rotation = 0) {
    this.ops.push({ k: 'text', layer, x, y, height, value, align, rotation })
  }
  /** filled arrowhead (length 3, width 1 paper mm) at (x, y) pointing along (ux, uy) */
  private arrow(x: number, y: number, ux: number, uy: number) {
    const l = 3 * this.n
    const w = 0.5 * this.n
    const bx = x - ux * l
    const by = y - uy * l
    this.ops.push({ k: 'solid', layer: 'DIM', points: [[x, y], [bx - uy * w, by + ux * w], [bx + uy * w, by - ux * w]] })
  }
  /**
   * Linear dimension (KS B 0001): thin dimension line `offset` from the feature (below / left when negative) with
   * filled arrows, extension lines from a 1 mm gap to 2 mm beyond it, the value in mm above the line (vertical:
   * turned to read from the right, on its left).
   */
  dimension(x1: number, y1: number, x2: number, y2: number, offset: number, dir: 'h' | 'v', label?: string) {
    const n = this.n
    const s = Math.sign(offset)
    const h = TEXT_DIM * n
    if (dir === 'h') {
      const y = y1 + offset
      for (const x of [x1, x2]) this.line('DIM', x, y1 + s * n, x, y + s * 2 * n)
      this.line('DIM', x1, y, x2, y)
      this.arrow(x1, y, -1, 0)
      this.arrow(x2, y, 1, 0)
      this.text('DIM', (x1 + x2) / 2, y + n, h, label ?? dimValue(Math.abs(x2 - x1)), 'centre')
    } else {
      const x = x1 + offset
      for (const yy of [y1, y2]) this.line('DIM', x1 + s * n, yy, x + s * 2 * n, yy)
      this.line('DIM', x, y1, x, y2)
      this.arrow(x, y1, 0, -1)
      this.arrow(x, y2, 0, 1)
      // the value on the line's far side from the feature, turned to read from the right
      this.text('DIM', s < 0 ? x - n : x + n + h, (y1 + y2) / 2, h, label ?? dimValue(Math.abs(y2 - y1)), 'centre', 90)
    }
  }
}

/** The sheet as DXF R12 text (model space full size, `$LTSCALE` = the scale's denominator). */
export function toDxf(sheet: Sheet): string {
  const out: string[] = []
  const put = (...pairs: (string | number)[]) => {
    for (let i = 0; i < pairs.length; i += 2) out.push(String(pairs[i]), typeof pairs[i + 1] === 'number' ? fix(pairs[i + 1] as number) : String(pairs[i + 1]))
  }
  for (const o of sheet.ops) {
    if (o.k === 'line') put(0, 'LINE', 8, o.layer, 10, o.x1, 20, o.y1, 30, 0, 11, o.x2, 21, o.y2, 31, 0)
    else if (o.k === 'poly') {
      put(0, 'POLYLINE', 8, o.layer, 66, '1', 10, 0, 20, 0, 30, 0, 70, o.closed ? '1' : '0', 40, o.width, 41, o.width)
      for (const [x, y] of o.points) put(0, 'VERTEX', 8, o.layer, 10, x, 20, y, 30, 0)
      put(0, 'SEQEND', 8, o.layer)
    } else if (o.k === 'circle') put(0, 'CIRCLE', 8, o.layer, 10, o.x, 20, o.y, 30, 0, 40, o.r)
    else if (o.k === 'text') {
      put(0, 'TEXT', 8, o.layer, 10, o.x, 20, o.y, 30, 0, 40, o.height, 1, ascii(o.value))
      if (o.rotation) put(50, o.rotation)
      if (o.align === 'centre') put(72, '1', 11, o.x, 21, o.y, 31, 0)
    } else {
      const [a, b, c] = o.points
      put(0, 'SOLID', 8, o.layer, 10, a[0], 20, a[1], 30, 0, 11, b[0], 21, b[1], 31, 0, 12, c[0], 22, c[1], 32, 0, 13, c[0], 23, c[1], 33, 0)
    }
  }
  const head = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '4', '9', '$LTSCALE', '40', fix(sheet.n), '0', 'ENDSEC']
  const total = PHANTOM.reduce((a, b) => a + Math.abs(b), 0)
  const tables = [
    '0', 'SECTION', '2', 'TABLES',
    '0', 'TABLE', '2', 'LTYPE', '70', '2',
    '0', 'LTYPE', '2', 'CONTINUOUS', '70', '0', '3', 'Solid line', '72', '65', '73', '0', '40', '0.0',
    '0', 'LTYPE', '2', 'PHANTOM', '70', '0', '3', 'Two-dot chain', '72', '65', '73', String(PHANTOM.length), '40', fix(total),
    ...PHANTOM.flatMap((v) => ['49', fix(v)]),
    '0', 'ENDTAB',
    '0', 'TABLE', '2', 'LAYER', '70', String(LAYERS.length),
    ...LAYERS.flatMap(([name, color, ltype]) => ['0', 'LAYER', '2', name, '70', '0', '62', String(color), '6', ltype]),
    '0', 'ENDTAB',
    '0', 'ENDSEC',
  ]
  return [...head, ...tables, '0', 'SECTION', '2', 'ENTITIES', ...out, '0', 'ENDSEC', '0', 'EOF', ''].join('\n')
}

/** Lays out the drawing (`layoutSheet`) and writes it as DXF R12. */
export const drawingDxf = (input: DrawingInput) => toDxf(layoutSheet(input))

/** the DXF (R12, no code page) takes ASCII: common symbols spelled out, anything else '?' */
const ascii = (s: string) =>
  s
    .replace(/Ø/g, '%%c')
    .replace(/×/g, 'x')
    .replace(/²/g, '^2')
    .replace(/±/g, '+/-')
    .replace(/[·•]/g, '.')
    .replace(/[–—−]/g, '-')
    .replace(/[^\x20-\x7e]/g, '?')

const fix = (v: number, digits = 4) => String(Number(v.toFixed(digits)))
