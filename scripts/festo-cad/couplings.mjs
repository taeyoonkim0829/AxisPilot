// Coupling clash check of step 5: every kit drawing on every axis type it fits by interface code (the axis type's
// shortest drawing), placed as src/cad/combo.ts does: kit axis face on the axis drive frame, the axis's own jaw hub
// turned to the kit hub (`coupling` in both JSONs), the kit's coupling placed by its `couplingShift`.
//   node scripts/festo-cad/couplings.mjs [axis type regex]           report the pairs whose coupling enters the axis
//   node scripts/festo-cad/couplings.mjs --write [axis type regex]   and give those kits a `couplingShift`
// A coupling point, moved 0.3 mm into the coupling, counts when it and its neighbours 0.4 mm around are inside one
// axis part (odd ray crossings along the shaft); points on the bore (touching the shaft) do not. --write moves the
// coupling towards the motor by the least that clears every axis type the kit fits (+ 0.5 mm) as long as it stays
// short of the kit's motor face, else turned end for end (its bores the other way round) first; kits it cannot clear
// are listed. Kits with their own jaw hub meshing with the axis's (`coupling`) are left alone.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { root } from './parts.mjs'

const args = process.argv.slice(2)
const write = args.includes('--write')
const only = args.find((a) => !a.startsWith('--'))
const typeFilter = only ? new RegExp(only) : null
const occt = await createRequire(import.meta.url)(join(root, 'node_modules/occt-import-js'))()
const COUPLING = /SFC|ALS-|SJC|SOHM|SDW|SHDW|DISK|(^|\s)EAM[CD]-/i

const sub = (a, b) => a.map((v, i) => v - b[i])
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const basis = (f) => [f.axis, f.up, cross(f.axis, f.up)]
const read = (file) => {
  const r = occt.ReadStepFile(readFileSync(file), null)
  if (!r.success) throw new Error(`occt could not read ${file}`)
  return r.meshes
}
const json = (file) => JSON.parse(readFileSync(file.replace(/\.stp$/i, '.json'), 'utf8'))

// ---- axis types (interface code, shortest drawing) and kits ----
const axes = readdirSync(join(root, 'data/axes/Festo')).filter((f) => f.endsWith('.json'))
  .flatMap((f) => JSON.parse(readFileSync(join(root, 'data/axes/Festo', f), 'utf8')).items)
const kits = ['axial', 'parallel'].flatMap((n) => JSON.parse(readFileSync(join(root, `data/kits/Festo/${n}.json`), 'utf8')).items)
const walk = (dir) => readdirSync(dir, { recursive: true }).filter((f) => /\.stp$/i.test(f)).map((f) => join(dir, f))
const kitFiles = walk(join(root, 'data/kits/Festo/Drawings'))
const kitFile = (k) =>
  kitFiles.find((f) => {
    const n = f.split(/[\\/]/).pop().replace(/\.stp$/i, '')
    return n === k.product || n === `${k.partNumber}_${k.product}`
  })
const axisFiles = walk(join(root, 'data/axes/Festo/Drawings'))
const types = new Map()
for (const a of axes) {
  const code = a.typeCode ?? a.model
  if (!a.interfaceCode || types.has(code)) continue
  const re = new RegExp(`^\\d+_${code.split('…').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(\\d+)')}\\.stp$`, 'i')
  const files = axisFiles
    .map((f) => [f, re.exec(f.split(/[\\/]/).pop())])
    .filter(([f, m]) => m && existsSync(f.replace(/\.stp$/i, '.json')))
    .sort((x, y) => Number(x[1][1] ?? 0) - Number(y[1][1] ?? 0))
  if (files.length) types.set(code, { code, iface: a.interfaceCode, file: files[0][0] })
}

// ---- inside test: rays along the shaft, the axis's triangles bucketed on the plane across it ----
function solids(meshes, d, reach) {
  const [a, u, w] = basis(d)
  const out = []
  for (const m of meshes) {
    const p = m.attributes.position.array
    const idx = m.index.array
    const tris = []
    for (let t = 0; t < idx.length; t += 3)
      tris.push([0, 1, 2].map((j) => {
        const q = sub([p[idx[t + j] * 3], p[idx[t + j] * 3 + 1], p[idx[t + j] * 3 + 2]], d.origin)
        return [dot(q, a), dot(q, u), dot(q, w)]
      }))
    if (!tris.some((v) => v.some((x) => Math.abs(x[0]) < reach && Math.hypot(x[1], x[2]) < reach))) continue
    // the cover cap on the shaft end the kit goes on comes off (combo.ts, EGC-HD-TB)
    if (/\(CUP\)/.test(m.name ?? '') && tris.every((v) => v.every((x) => x[0] > -10 && x[0] < 5 && Math.hypot(x[1], x[2]) < 60))) continue
    const grid = new Map()
    for (const v of tris) {
      const lo = [1, 2].map((k) => Math.floor(Math.min(v[0][k], v[1][k], v[2][k])))
      const hi = [1, 2].map((k) => Math.floor(Math.max(v[0][k], v[1][k], v[2][k])))
      if ((hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) > 40000) continue
      for (let i = lo[0]; i <= hi[0]; i++)
        for (let j = lo[1]; j <= hi[1]; j++) {
          const key = i * 100003 + j
          if (!grid.has(key)) grid.set(key, [])
          grid.get(key).push(v)
        }
    }
    out.push({ name: m.name ?? '', grid })
  }
  return out
}
function inside(s, q) {
  const list = s.grid.get(Math.floor(q[1]) * 100003 + Math.floor(q[2]))
  if (!list) return false
  let n = 0
  for (const [A, B, C] of list) {
    const d = (B[1] - A[1]) * (C[2] - A[2]) - (C[1] - A[1]) * (B[2] - A[2])
    if (Math.abs(d) < 1e-12) continue
    const l1 = ((B[1] - q[1]) * (C[2] - q[2]) - (C[1] - q[1]) * (B[2] - q[2])) / d
    const l2 = ((C[1] - q[1]) * (A[2] - q[2]) - (A[1] - q[1]) * (C[2] - q[2])) / d
    const l3 = 1 - l1 - l2
    if (l1 < 0 || l2 < 0 || l3 < 0) continue
    if (l1 * A[0] + l2 * B[0] + l3 * C[0] > q[0]) n++
  }
  return n % 2 === 1
}

/** kit coordinates: the coupling turned end for end about `flip` (a half turn about the face's up) and moved `by` */
const shifted = (f, s) => (p) => {
  let q = p
  if (s?.flip) {
    const v = sub(p, s.flip)
    const along = dot(v, f.up)
    q = [0, 1, 2].map((i) => s.flip[i] + 2 * along * f.up[i] - v[i])
  }
  return [0, 1, 2].map((i) => q[i] + (s?.by ?? 0) * f.axis[i])
}

/** One pair: hits(extra, flip) counts the coupling points inside the axis with the coupling moved `extra` mm more
 *  (and turned end for end about `flip`); `end` is its motor end and `face` the motor face, from the drive face. */
function pair(axisJson, S, meta, coupling) {
  const drive = axisJson.drive
  const [, u, w] = basis(drive)
  const [ka, ku, kw] = basis(meta.axisFace)
  const local = (p) => {
    const q = sub(p, meta.axisFace.origin)
    return [dot(q, ka), dot(q, ku), dot(q, kw)] // = drive-local [along, u, w] once mated
  }
  // the axis hub's turn (combo.ts turnHub), applied here as the kit turned the other way
  let turn = 0
  if (axisJson.coupling && meta.coupling?.count === axisJson.coupling.count) {
    const A = [dot(axisJson.coupling.jaw, u), dot(axisJson.coupling.jaw, w)]
    const B = [dot(meta.coupling.jaw, ku), dot(meta.coupling.jaw, kw)]
    const pitch = (2 * Math.PI) / axisJson.coupling.count
    turn = Math.atan2(A[0] * B[1] - A[1] * B[0], A[0] * B[0] + A[1] * B[1])
    turn -= pitch * Math.round(turn / pitch)
  }
  const [c, s] = [Math.cos(-turn), Math.sin(-turn)]
  const own = (m) => (meta.couplingShift?.parts.includes(m.name.trim()) ? meta.couplingShift : null)
  const hits = (extra = 0, flip = null) => {
    let n = 0
    for (const m of coupling) {
      const base = own(m)
      const place = shifted(meta.axisFace, { flip: flip ?? base?.flip, by: (base?.by ?? 0) + extra })
      const p = m.attributes.position.array
      const nrm = m.attributes.normal?.array
      const pts = []
      let rMin = Infinity
      for (let i = 0; i < p.length; i += 3) {
        const x = [p[i], p[i + 1], p[i + 2]]
        const q0 = local(place(nrm ? x.map((v, j) => v - 0.3 * nrm[i + j]) : x))
        const q = [q0[0], c * q0[1] - s * q0[2], s * q0[1] + c * q0[2]]
        rMin = Math.min(rMin, Math.hypot(q[1], q[2]))
        pts.push(q)
      }
      for (const q of pts) {
        if (Math.hypot(q[1], q[2]) < rMin + 0.6) continue
        const around = [[0, 0.4, 0], [0, -0.4, 0], [0, 0, 0.4], [0, 0, -0.4], [0.4, 0, 0], [-0.4, 0, 0]].map((d) => q.map((v, j) => v + d[j]))
        if (S.some((sol) => inside(sol, q) && around.every((r) => inside(sol, r)))) n++
      }
    }
    return n
  }
  const extent = (flip) => {
    let lo = Infinity
    let hi = -Infinity
    for (const m of coupling) {
      const base = own(m)
      const place = shifted(meta.axisFace, { flip: flip ?? base?.flip, by: base?.by ?? 0 })
      const p = m.attributes.position.array
      for (let i = 0; i < p.length; i += 3) {
        const t = local(place([p[i], p[i + 1], p[i + 2]]))[0]
        lo = Math.min(lo, t)
        hi = Math.max(hi, t)
      }
    }
    return [lo, hi]
  }
  return { hits, extent, face: local(meta.motorFace.origin)[0] }
}

/** the least extra shift (0.5 mm steps) clearing the axis with the coupling short of the motor face, or null */
function clearing(p, flip = null) {
  const room = p.face - p.extent(flip)[1]
  for (let s = 0; s <= room; s += 0.5) if (!p.hits(s, flip)) return s
  return null
}

const kitCache = new Map()
const needs = new Map() // kit file → { kit, pairs: [pair] }
for (const t of types.values()) {
  if (typeFilter && !typeFilter.test(t.code)) continue
  const fits = kits.filter((k) => k.axisCode === t.iface && kitFile(k))
  if (!fits.length) continue
  const axisJson = json(t.file)
  const S = solids(read(t.file), axisJson.drive, 160)
  for (const k of fits) {
    const f = kitFile(k)
    if (!existsSync(f.replace(/\.stp$/i, '.json'))) continue
    if (!kitCache.has(f)) kitCache.set(f, read(f).filter((m) => COUPLING.test(m.name ?? '')))
    const coupling = kitCache.get(f)
    if (!coupling.length) continue
    const meta = json(f)
    const p = pair(axisJson, S, meta, coupling)
    const n = p.hits()
    if (!n) continue
    console.log(`${t.code}\t${k.product}\t${n} coupling points inside the axis`)
    if (!needs.has(f)) needs.set(f, { kit: k, meta, coupling, pairs: [] })
    needs.get(f).pairs.push(p)
  }
}

if (write) {
  for (const [f, { kit, meta, coupling, pairs }] of needs) {
    if (meta.coupling) {
      console.log(`${kit.product}: its jaw hub meshes with the axis's, left alone`)
      continue
    }
    const fit = (flip) => {
      const s = pairs.map((p) => clearing(p, flip))
      return s.every((x) => x != null) ? Math.max(...s) : null
    }
    let flip = null
    let extra = fit(null)
    if (extra == null) {
      // turned end for end about the coupling's centre (as placed now)
      const [lo, hi] = pairs[0].extent(null)
      const mid = (lo + hi) / 2 - (meta.couplingShift?.by ?? 0)
      const o = meta.axisFace
      flip = o.origin.map((v, i) => Number((v + mid * o.axis[i]).toFixed(2)))
      extra = fit(flip)
    }
    if (extra == null) {
      console.log(`${kit.product}: cannot clear the axis within the kit (the coupling's bore smaller than the shaft?)`)
      continue
    }
    const parts = meta.couplingShift?.parts ?? [...new Set(coupling.map((m) => m.name.trim()))]
    const by = Number(((meta.couplingShift?.by ?? 0) + extra + 0.5).toFixed(2))
    // a flip it has already stays (the shift was found with it)
    const turned = flip ?? meta.couplingShift?.flip
    const couplingShift = { parts, by, ...(turned ? { flip: turned } : {}) }
    console.log(`${kit.product}: ${JSON.stringify(couplingShift)}`)
    const out = f.replace(/\.stp$/i, '.json')
    const old = JSON.parse(readFileSync(out, 'utf8'))
    const inline = (v) => (Array.isArray(v) ? `[${v.map(inline).join(', ')}]` : v && typeof v === 'object' ? `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }` : JSON.stringify(v))
    const next = { ...old, couplingShift }
    writeFileSync(out, `{\n${Object.entries(next).map(([k, v]) => `  ${JSON.stringify(k)}: ${inline(v)}`).join(',\n')}\n}\n`)
  }
}
