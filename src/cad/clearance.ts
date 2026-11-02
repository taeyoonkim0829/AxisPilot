import type { ComboPart } from './combo'
import type { Vec3 } from './step'

// Clearance check of a gantry drawing at the ends of the Y travel: what the Y slide carries (the Z axis with its drive,
// the Y–Z gantry kit) moved to each end, against what it passes (the X axes with their drives and the X–Y kits, the
// Y axis's own drive). On the tessellated meshes: boxes first, then points of one body inside the other (ray parity).

/** A body of the drawing as the 3D view has it (`PartMesh`): its part (index into `parts`), positions, triangles */
export interface BodyMesh {
  part: number
  name: string
  positions: Float32Array
  index: Uint32Array
}

export interface EndClash {
  /** −1: the Y slide at the start end of its travel, +1 at the far end */
  end: -1 | 1
  /** part names (as in the drawing: `Z ELGT-BS-90-200-10P`, `EHAM-MA-…`) of the moving and the fixed body */
  moving: string
  fixed: string
}

/** mm a box must reach into another before the bodies are looked at (contact and rounding stay out) */
const MARGIN = 0.5
/** body points inside the other body for a clash (one stray point is rounding at a shared face) */
const MIN_POINTS = 3

interface Body {
  mesh: BodyMesh
  lo: Vec3
  hi: Vec3
}

function box(m: BodyMesh): Body {
  const lo: Vec3 = [Infinity, Infinity, Infinity]
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity]
  const p = m.positions
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[i + k])
      hi[k] = Math.max(hi[k], p[i + k])
    }
  return { mesh: m, lo, hi }
}

const overlaps = (a: Body, da: Vec3, b: Body) =>
  [0, 1, 2].every((k) => a.lo[k] + da[k] < b.hi[k] - MARGIN && b.lo[k] < a.hi[k] + da[k] - MARGIN)

/** Is point q inside the closed mesh (odd crossings of a ray along +x; the ray nudged off the axis planes)? */
function inside(m: BodyMesh, q: Vec3): boolean {
  const p = m.positions
  const idx = m.index
  const y = q[1] + 1.37e-4
  const z = q[2] + 2.91e-4
  let n = 0
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3
    const b = idx[t + 1] * 3
    const c = idx[t + 2] * 3
    const d = (p[b + 1] - p[a + 1]) * (p[c + 2] - p[a + 2]) - (p[c + 1] - p[a + 1]) * (p[b + 2] - p[a + 2])
    if (Math.abs(d) < 1e-12) continue
    const l1 = ((p[b + 1] - y) * (p[c + 2] - z) - (p[c + 1] - y) * (p[b + 2] - z)) / d
    const l2 = ((p[c + 1] - y) * (p[a + 2] - z) - (p[a + 1] - y) * (p[c + 2] - z)) / d
    const l3 = 1 - l1 - l2
    if (l1 < 0 || l2 < 0 || l3 < 0) continue
    if (l1 * p[a] + l2 * p[b] + l3 * p[c] > q[0]) n++
  }
  return n % 2 === 1
}

/** points of `from` (moved by d) inside `into` (moved by e), counted up to MIN_POINTS, inside both boxes only */
function pointsInside(from: Body, d: Vec3, into: Body, e: Vec3): number {
  const p = from.mesh.positions
  let n = 0
  for (let i = 0; i < p.length; i += 3) {
    const q: Vec3 = [p[i] + d[0] - e[0], p[i + 1] + d[1] - e[1], p[i + 2] + d[2] - e[2]]
    if (![0, 1, 2].every((k) => q[k] > into.lo[k] + MARGIN && q[k] < into.hi[k] - MARGIN)) continue
    if (inside(into.mesh, q) && ++n >= MIN_POINTS) return n
  }
  return n
}

/**
 * Edges of `from` (moved by d) passing through triangles of `into` (moved by e) more than MARGIN from both edge ends
 * (an edge ending on a face it rests on does not count; faces lying on each other are parallel), counted up to
 * MIN_POINTS: two bodies crossing each other (a vertical profile through a horizontal one) have no corner inside the other.
 */
function crossings(from: Body, d: Vec3, into: Body, e: Vec3): number {
  // the boxes' common part: only triangles and edges reaching it can meet
  const lo = [0, 1, 2].map((k) => Math.max(from.lo[k] + d[k], into.lo[k] + e[k]))
  const hi = [0, 1, 2].map((k) => Math.min(from.hi[k] + d[k], into.hi[k] + e[k]))
  // the triangles of `into` reaching the common part
  const q = into.mesh.positions
  const qi = into.mesh.index
  const tris: number[][] = []
  for (let t = 0; t < qi.length; t += 3) {
    const v = [qi[t] * 3, qi[t + 1] * 3, qi[t + 2] * 3].map((a) => [q[a] + e[0], q[a + 1] + e[1], q[a + 2] + e[2]])
    if ([0, 1, 2].every((k) => Math.max(v[0][k], v[1][k], v[2][k]) >= lo[k] && Math.min(v[0][k], v[1][k], v[2][k]) <= hi[k])) tris.push(v.flat())
  }
  if (!tris.length) return 0
  const p = from.mesh.positions
  const pi = from.mesh.index
  let n = 0
  for (let t = 0; t < pi.length; t += 3)
    for (let j = 0; j < 3; j++) {
      const a = pi[t + j] * 3
      const b = pi[t + ((j + 1) % 3)] * 3
      if (a > b) continue // each edge once (from one of its two triangles)
      const s: Vec3 = [p[a] + d[0], p[a + 1] + d[1], p[a + 2] + d[2]]
      const u: Vec3 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]]
      if (![0, 1, 2].every((k) => Math.max(s[k], s[k] + u[k]) >= lo[k] && Math.min(s[k], s[k] + u[k]) <= hi[k])) continue
      for (const v of tris) {
        // Möller–Trumbore, segment s + λu, λ in (0, 1)
        const e1 = [v[3] - v[0], v[4] - v[1], v[5] - v[2]]
        const e2 = [v[6] - v[0], v[7] - v[1], v[8] - v[2]]
        const h = [u[1] * e2[2] - u[2] * e2[1], u[2] * e2[0] - u[0] * e2[2], u[0] * e2[1] - u[1] * e2[0]]
        const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2]
        if (Math.abs(det) < 1e-9) continue
        const w = [s[0] - v[0], s[1] - v[1], s[2] - v[2]]
        const bu = (w[0] * h[0] + w[1] * h[1] + w[2] * h[2]) / det
        if (bu < 0 || bu > 1) continue
        const c = [w[1] * e1[2] - w[2] * e1[1], w[2] * e1[0] - w[0] * e1[2], w[0] * e1[1] - w[1] * e1[0]]
        const bv = (u[0] * c[0] + u[1] * c[1] + u[2] * c[2]) / det
        if (bv < 0 || bu + bv > 1) continue
        const lambda = (e2[0] * c[0] + e2[1] * c[1] + e2[2] * c[2]) / det
        const ends = MARGIN / Math.hypot(u[0], u[1], u[2])
        if (lambda > ends && lambda < 1 - ends && ++n >= MIN_POINTS) return n
      }
    }
  return n
}

/**
 * Bodies the Y slide carries that run into the fixed ones with the slide at either end of its travel (from where it is
 * drawn, `offset` mm along `travel` from the middle). Moving: the Z axis's parts and the gantry kits on the Y slide.
 * Fixed: the X axes' parts, the gantry kits on the X slides and the Y axis's drive (kit, gearbox, motor). One entry
 * per end and pair of parts.
 */
export function yEndClashes(parts: ComboPart[], meshes: BodyMesh[], y: { travel: Vec3; stroke: number; offset: number }): EndClash[] {
  const moving = (p: ComboPart) => p.axis === 'z' || (p.role === 'adapter' && p.axis === 'y')
  const fixed = (p: ComboPart) => p.axis === 'x' || (p.axis === 'y' && p.role !== 'axis' && p.role !== 'adapter')
  const bodies = meshes.map(box)
  const a = bodies.filter((b) => moving(parts[b.mesh.part]))
  const f = bodies.filter((b) => fixed(parts[b.mesh.part]))
  const out: EndClash[] = []
  const seen = new Set<string>()
  for (const end of [-1, 1] as const) {
    const s = (end * y.stroke) / 2 - y.offset
    const d: Vec3 = [y.travel[0] * s, y.travel[1] * s, y.travel[2] * s]
    for (const m of a)
      for (const b of f) {
        const key = `${end}|${parts[m.mesh.part].name}|${parts[b.mesh.part].name}`
        if (seen.has(key) || !overlaps(m, d, b)) continue
        const o: Vec3 = [0, 0, 0]
        if (
          crossings(m, d, b, o) >= MIN_POINTS ||
          crossings(b, o, m, d) >= MIN_POINTS ||
          pointsInside(m, d, b, o) >= MIN_POINTS ||
          pointsInside(b, o, m, d) >= MIN_POINTS
        ) {
          seen.add(key)
          out.push({ end, moving: parts[m.mesh.part].name, fixed: parts[b.mesh.part].name })
        }
      }
  }
  return out
}
